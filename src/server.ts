import http from "node:http";
import path from "node:path";
import tls from "node:tls";
import WebSocket, { WebSocketServer } from "ws";
import { certForHost, initCerts, caPath } from "./cert.js";
import { CONFIG, initConfig } from "./config.js";
import { log } from "./logger.js";
import { printBanner } from "./banner.js";
import {
  describeRequest,
  isMockablePostPath,
  isInternalUtilityPrompt,
  isInternalUtilityBody,
  parseIncomingPathname,
} from "./request.js";
import { loadPromptRules, findRule, renderOutputText } from "./rules.js";
import {
  buildFrames,
  buildChatCompletionsChunks,
  buildAnthropicMessagesEvents,
  streamOverWebSocket,
  streamOverSSE,
  streamOverChatCompletionsSSE,
  streamOverAnthropicMessagesSSE,
} from "./streaming.js";
import { proxyHttpToUpstream, connectWsFallback } from "./proxy.js";

export function startServer(configPath: string) {
  initConfig(configPath);
  initCerts();

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      const method = String(req.method || "GET").toUpperCase();
      const requestPathname = parseIncomingPathname(req.url, req.headers);
      const mockablePostPath = isMockablePostPath(requestPathname);
      const { prompt, summary } = describeRequest(body);
      log(`HTTP ${req.method || "GET"} ${req.url || "/"} ${summary}`);
      if (body && CONFIG.logRequestBodies) log(`HTTP body <- ${body}`);

      if (method !== "POST") {
        await proxyHttpToUpstream(req, res, body);
        return;
      }

      // Keep control-plane POST calls (e.g. /models/session) on real upstream APIs
      // so model negotiation/auth flow stays intact.
      if (!mockablePostPath) {
        await proxyHttpToUpstream(req, res, body);
        return;
      }

      const isChatCompletionsPath =
        /\/(chat\/completions|v1\/chat\/completions)$/i.test(requestPathname);
      const isAnthropicMessagesPath =
        /\/(messages|v1\/messages)$/i.test(requestPathname);

      const rules = loadPromptRules();
      const matched = findRule(prompt, rules);

      // New chats trigger internal utility requests on /chat/completions
      // (title/progress generation). If the matched rule has a `title` field,
      // return that as the response so VS Code shows it as the chat title.
      // If nothing matches, fall back to upstream for a real title.
      if (
        isChatCompletionsPath &&
        (isInternalUtilityPrompt(prompt) || isInternalUtilityBody(body))
      ) {
        if (matched?.title) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
            "Cache-Control": "no-cache",
          });
          await streamOverChatCompletionsSSE(
            res,
            buildChatCompletionsChunks(matched.title),
          );
          return;
        }
        await proxyHttpToUpstream(req, res, body);
        return;
      }

      if (!matched && CONFIG.forwardUnmatched) {
        log(
          "HTTP unmatched prompt; forwarding to upstream because forwardUnmatched=true",
        );
        await proxyHttpToUpstream(req, res, body);
        return;
      }

      const responseText = matched
        ? renderOutputText(matched.text, matched.tags)
        : CONFIG.defaultResponse;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      });

      if (isChatCompletionsPath) {
        await streamOverChatCompletionsSSE(
          res,
          buildChatCompletionsChunks(responseText),
        );
        return;
      }

      if (isAnthropicMessagesPath) {
        await streamOverAnthropicMessagesSSE(
          res,
          buildAnthropicMessagesEvents(responseText),
        );
        return;
      }

      await streamOverSSE(res, buildFrames(responseText));
    });
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    log(`WS connection opened on ${req.url || "/"}`);

    let upstreamWs: WebSocket | null = null;
    let upstreamConnecting: Promise<WebSocket> | null = null;

    const ensureUpstream = async () => {
      if (upstreamWs && upstreamWs.readyState === upstreamWs.OPEN)
        return upstreamWs;
      if (upstreamConnecting) return upstreamConnecting;

      upstreamConnecting = connectWsFallback(req)
        .then((socket) => {
          upstreamWs = socket;

          upstreamWs.on("message", (payload, isBinary) => {
            if (ws.readyState === ws.OPEN) ws.send(payload, { binary: isBinary });
          });

          upstreamWs.on("close", (code, reason) => {
            if (ws.readyState === ws.OPEN) ws.close(code, reason.toString());
          });

          upstreamWs.on("error", (error) => {
            log(`WS upstream error: ${(error as Error).message}`);
            if (ws.readyState === ws.OPEN) ws.close(1011, "WS upstream error");
          });

          return upstreamWs;
        })
        .finally(() => {
          upstreamConnecting = null;
        });

      return upstreamConnecting;
    };

    ws.on("message", async (data) => {
      const raw = data.toString();
      const { prompt, summary } = describeRequest(raw);
      log(`WS <- ${summary}`);
      if (CONFIG.logRequestBodies) log(`WS frame <- ${raw}`);

      const rules = loadPromptRules();
      const matched = findRule(prompt, rules);

      if (!matched && CONFIG.forwardUnmatched) {
        log(
          "WS unmatched prompt; forwarding to upstream because forwardUnmatched=true",
        );
        try {
          const upstream = await ensureUpstream();
          if (upstream.readyState === upstream.OPEN) upstream.send(data);
        } catch (error) {
          log(`WS passthrough unavailable: ${(error as Error).message}`);
          if (ws.readyState === ws.OPEN) ws.close(1011, "WS passthrough failed");
        }
        return;
      }

      const responseText = matched
        ? renderOutputText(matched.text, matched.tags)
        : CONFIG.defaultResponse;

      await streamOverWebSocket(ws, buildFrames(responseText));
    });

    ws.on("close", () => {
      if (upstreamWs && upstreamWs.readyState === upstreamWs.OPEN)
        upstreamWs.close();
      log("WS connection closed");
    });

    ws.on("error", (error) => {
      log(`WS error: ${(error as Error).message}`);
    });
  });

  server.on("connect", (req, clientSocket, head) => {
    const hostPort = req.url ?? "";
    const colonIdx = hostPort.lastIndexOf(":");
    const hostname = colonIdx !== -1 ? hostPort.slice(0, colonIdx) : hostPort;

    if (!hostname) {
      clientSocket.destroy();
      return;
    }

    log(`CONNECT ${hostPort}`);
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    if (head?.length) {
      clientSocket.unshift(head);
    }

    const { cert, key } = certForHost(hostname);
    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      cert,
      key,
      ALPNProtocols: ["http/1.1"],
    });
    tlsSocket.once("error", (err) => {
      log(`TLS error for ${hostname}: ${(err as Error).message}`);
    });

    server.emit("connection", tlsSocket);
  });

  server.listen(CONFIG.port, () => {
    const src = CONFIG.responses
      ? "inline responses[]"
      : path.resolve(CONFIG.responsesPath);
    const ruleCount = loadPromptRules().length;
    printBanner({
      port: CONFIG.port,
      configPath: path.resolve(configPath),
      responsesSrc: src,
      caCertPath: caPath(),
      ruleCount,
    });
  });
}

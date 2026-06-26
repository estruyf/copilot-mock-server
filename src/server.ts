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
  isSummarizationUtilityBody,
  isToolResultRequest,
  parseIncomingPathname,
  parseRequestModel,
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
import { proxyHttpToUpstream, proxyHttpToUpstreamTee, connectWsFallback } from "./proxy.js";
import { recordInteraction, recordInteractionFromWsFrames, type ApiPathType } from "./learner.js";

export function startServer(configPath: string, overrides?: Partial<import("./types.js").Config>) {
  initConfig(configPath);
  if (overrides) Object.assign(CONFIG, overrides);
  initCerts();

  let lastMatchedRule: import("./types.js").NormalizedRule | null = null;

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
      // (title/progress/summarization). Use `outcome` for summarization if
      // defined on the last matched rule, `title` for title generation, or
      // fall back to upstream so Copilot can generate real metadata.
      if (
        isChatCompletionsPath &&
        (isInternalUtilityPrompt(prompt) || isInternalUtilityBody(body))
      ) {
        if (isSummarizationUtilityBody(body) && lastMatchedRule?.outcome) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
            "Cache-Control": "no-cache",
          });
          await streamOverChatCompletionsSSE(
            res,
            buildChatCompletionsChunks(lastMatchedRule.outcome),
          );
          return;
        }
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

      // Tool-result follow-ups (VS Code sends these after executing a function call).
      // Return a silent empty completion so the defaultResponse doesn't bleed in.
      if (isToolResultRequest(body)) {
        log("HTTP tool-result follow-up; returning empty completion");
        const toolResultModel = parseRequestModel(body) ?? undefined;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache",
        });
        if (isChatCompletionsPath) {
          await streamOverChatCompletionsSSE(res, buildChatCompletionsChunks("", toolResultModel));
        } else if (isAnthropicMessagesPath) {
          await streamOverAnthropicMessagesSSE(res, buildAnthropicMessagesEvents("", toolResultModel));
        } else {
          await streamOverSSE(res, buildFrames("", toolResultModel));
        }
        return;
      }

      if (matched) lastMatchedRule = matched;

      if (CONFIG.learningMode) {
        const isUtility = isInternalUtilityPrompt(prompt) || isInternalUtilityBody(body);
        const pathType: ApiPathType = isChatCompletionsPath
          ? "chat"
          : isAnthropicMessagesPath
            ? "anthropic"
            : "responses";
        const sseBody = await proxyHttpToUpstreamTee(req, res, body);
        if (sseBody && prompt && !isUtility) {
          recordInteraction(prompt, sseBody, pathType);
        }
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
      const toolCalls = matched?.toolCalls ?? [];
      const steps = matched?.steps ?? [];
      const delayMs = matched?.delayMs ?? 0;

      const requestedModel = parseRequestModel(body) ?? undefined;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      });

      if (isChatCompletionsPath) {
        await streamOverChatCompletionsSSE(
          res,
          buildChatCompletionsChunks(responseText, requestedModel),
        );
        return;
      }

      if (isAnthropicMessagesPath) {
        await streamOverAnthropicMessagesSSE(
          res,
          buildAnthropicMessagesEvents(responseText, requestedModel),
        );
        return;
      }

      await streamOverSSE(res, buildFrames(responseText, requestedModel, toolCalls, steps, delayMs));
    });
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    log(`WS connection opened on ${req.url || "/"}`);

    let upstreamWs: WebSocket | null = null;
    let upstreamConnecting: Promise<WebSocket> | null = null;

    let wsLearnPendingPrompt = "";
    const wsLearnFrames: string[] = [];

    const ensureUpstream = async () => {
      if (upstreamWs && upstreamWs.readyState === upstreamWs.OPEN)
        return upstreamWs;
      if (upstreamConnecting) return upstreamConnecting;

      upstreamConnecting = connectWsFallback(req)
        .then((socket) => {
          upstreamWs = socket;

          upstreamWs.on("message", (payload, isBinary) => {
            if (ws.readyState === ws.OPEN) ws.send(payload, { binary: isBinary });

            if (CONFIG.learningMode && wsLearnPendingPrompt) {
              const frameStr = payload.toString();
              wsLearnFrames.push(frameStr);
              try {
                const obj = JSON.parse(frameStr) as Record<string, unknown>;
                if (obj.type === "response.completed") {
                  const capturedPrompt = wsLearnPendingPrompt;
                  const capturedFrames = [...wsLearnFrames];
                  wsLearnPendingPrompt = "";
                  wsLearnFrames.length = 0;
                  recordInteractionFromWsFrames(capturedPrompt, capturedFrames);
                }
              } catch { /* non-JSON WS frame */ }
            }
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

      if (isToolResultRequest(raw)) {
        log("WS tool-result follow-up; returning empty completion");
        const wsToolResultModel = parseRequestModel(raw) ?? undefined;
        await streamOverWebSocket(ws, buildFrames("", wsToolResultModel));
        return;
      }

      if (CONFIG.learningMode) {
        log("WS learn mode; forwarding to upstream");
        const isUtility = isInternalUtilityPrompt(prompt) || isInternalUtilityBody(raw);
        if (prompt && !isUtility) wsLearnPendingPrompt = prompt;
        try {
          const upstream = await ensureUpstream();
          if (upstream.readyState === upstream.OPEN) upstream.send(data);
        } catch (error) {
          log(`WS learn passthrough unavailable: ${(error as Error).message}`);
          if (ws.readyState === ws.OPEN) ws.close(1011, "WS learn passthrough failed");
        }
        return;
      }

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
      const wsToolCalls = matched?.toolCalls ?? [];
      const wsSteps = matched?.steps ?? [];
      const wsDelayMs = matched?.delayMs ?? 0;

      const wsModel = parseRequestModel(raw) ?? undefined;
      await streamOverWebSocket(ws, buildFrames(responseText, wsModel, wsToolCalls, wsSteps, wsDelayMs));
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
      learningMode: CONFIG.learningMode,
      learnFile: path.resolve(CONFIG.learnFile),
      learningModeRaw: CONFIG.learningModeRaw,
    });
  });
}

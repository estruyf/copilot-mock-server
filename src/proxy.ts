import type { IncomingMessage, ServerResponse } from "node:http";
import WebSocket from "ws";
import { CONFIG } from "./config.js";
import { log } from "./logger.js";
import { parseIncomingTarget, sanitizeForwardHeaders } from "./request.js";

export async function proxyHttpToUpstream(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
) {
  const pathWithQuery = parseIncomingTarget(req.url, req.headers);
  const method = String(req.method || "GET").toUpperCase();
  const headers = sanitizeForwardHeaders(req.headers);

  const urls = [
    `${CONFIG.fallbackBaseUrl}${pathWithQuery}`,
    `${CONFIG.fallbackAltBaseUrl}${pathWithQuery}`,
  ];

  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const upstream = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
      });

      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        if (k.toLowerCase() !== "transfer-encoding") responseHeaders[k] = v;
      });

      res.writeHead(upstream.status, responseHeaders);
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          res.write(chunk);
        }
      }
      res.end();
      log(
        `HTTP passthrough ${method} ${req.url || "/"} -> ${url} (${upstream.status})`,
      );
      return;
    } catch (error) {
      lastError = error as Error;
      log(`HTTP passthrough failed ${url}: ${lastError.message}`);
    }
  }

  res.writeHead(502, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Upstream passthrough failed",
      detail: lastError?.message || "unknown error",
    }),
  );
}

export async function connectWsFallback(req: IncomingMessage): Promise<WebSocket> {
  const pathWithQuery = parseIncomingTarget(req.url, req.headers);
  const primaryBase = new URL(CONFIG.fallbackBaseUrl);
  const secondaryBase = new URL(CONFIG.fallbackAltBaseUrl);
  primaryBase.protocol = "wss:";
  secondaryBase.protocol = "wss:";

  const urls = [
    `${primaryBase.origin}${pathWithQuery}`,
    `${secondaryBase.origin}${pathWithQuery}`,
  ];

  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const upstream = await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url, {
          headers: sanitizeForwardHeaders(req.headers),
        });
        ws.once("open", () => resolve(ws));
        ws.once("error", (err) => reject(err));
      });
      log(`WS passthrough established ${req.url || "/"} -> ${url}`);
      return upstream;
    } catch (error) {
      lastError = error as Error;
      log(`WS passthrough failed ${url}: ${lastError.message}`);
    }
  }

  throw lastError || new Error("Unable to connect WS upstream");
}

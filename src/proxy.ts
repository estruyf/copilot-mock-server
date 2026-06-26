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

  // When the request arrives through a CONNECT tunnel the Host header carries
  // the real target host (e.g. github.com). Forward there directly instead of
  // routing everything through the Copilot API fallback URLs.
  const rawHost = (req.headers.host ?? "").replace(/:\d+$/, "");
  const isLocalhost =
    !rawHost || rawHost === "localhost" || rawHost.startsWith("127.");

  // Try the individual endpoint first: it works for free/individual-tier tokens
  // and returns the correct available_models in POST /models/session.  Team and
  // Enterprise tokens that are not accepted by the individual endpoint will get
  // a 4xx, which triggers the fallback to the primary (team) URL.
  const urls = isLocalhost
    ? [
        `${CONFIG.fallbackAltBaseUrl}${pathWithQuery}`,
        `${CONFIG.fallbackBaseUrl}${pathWithQuery}`,
      ]
    : [`https://${rawHost}${pathWithQuery}`];

  let lastError: Error | null = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isLastUrl = i === urls.length - 1;
    try {
      const upstream = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
      });

      // On 4xx, try the next URL if one is available rather than surfacing the
      // error to the client — the Copilot API sometimes returns 400 during a
      // token-refresh cycle, and VS Code's model picker breaks if it sees that.
      if (upstream.status >= 400 && upstream.status < 500 && !isLastUrl) {
        log(
          `HTTP passthrough ${method} ${req.url || "/"} -> ${url} (${upstream.status}) — trying alt URL`,
        );
        if (upstream.body) {
          for await (const _ of upstream.body) { /* drain */ }
        }
        continue;
      }

      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        const lower = k.toLowerCase();
        // transfer-encoding: Node.js handles chunking for us
        // content-encoding: undici auto-decompresses but keeps this header — body
        //   is already plain text so forwarding "gzip" would corrupt the response
        // content-length: refers to the compressed size; wrong after decompression
        if (
          lower === "transfer-encoding" ||
          lower === "content-encoding" ||
          lower === "content-length"
        ) {
          return;
        }
        responseHeaders[k] = v;
      });

      res.writeHead(upstream.status, responseHeaders);
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (res.writableEnded) break;
          res.write(chunk);
        }
      }
      if (!res.writableEnded) res.end();
      log(
        `HTTP passthrough ${method} ${req.url || "/"} -> ${url} (${upstream.status})`,
      );
      return;
    } catch (error) {
      lastError = error as Error;
      log(`HTTP passthrough failed ${url}: ${lastError.message}`);
    }
  }

  if (!res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Upstream passthrough failed",
        detail: lastError?.message || "unknown error",
      }),
    );
  }
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

/**
 * Like proxyHttpToUpstream but returns the full response body as a UTF-8
 * string so the caller can parse it for learning mode recording.
 */
export async function proxyHttpToUpstreamTee(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): Promise<string> {
  const pathWithQuery = parseIncomingTarget(req.url, req.headers);
  const method = String(req.method || "GET").toUpperCase();
  const headers = sanitizeForwardHeaders(req.headers);

  const rawHost = (req.headers.host ?? "").replace(/:\d+$/, "");
  const isLocalhost =
    !rawHost || rawHost === "localhost" || rawHost.startsWith("127.");

  const urls = isLocalhost
    ? [
        `${CONFIG.fallbackAltBaseUrl}${pathWithQuery}`,
        `${CONFIG.fallbackBaseUrl}${pathWithQuery}`,
      ]
    : [`https://${rawHost}${pathWithQuery}`];

  let lastError: Error | null = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isLastUrl = i === urls.length - 1;
    try {
      const upstream = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
      });

      if (upstream.status >= 400 && upstream.status < 500 && !isLastUrl) {
        log(
          `HTTP passthrough (learn) ${method} ${req.url || "/"} -> ${url} (${upstream.status}) — trying alt URL`,
        );
        if (upstream.body) {
          for await (const _ of upstream.body) { /* drain */ }
        }
        continue;
      }

      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        const lower = k.toLowerCase();
        if (
          lower === "transfer-encoding" ||
          lower === "content-encoding" ||
          lower === "content-length"
        ) {
          return;
        }
        responseHeaders[k] = v;
      });

      res.writeHead(upstream.status, responseHeaders);

      const chunks: Buffer[] = [];
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (res.writableEnded) break;
          res.write(chunk);
          chunks.push(Buffer.from(chunk as Uint8Array));
        }
      }
      if (!res.writableEnded) res.end();

      log(
        `HTTP passthrough (learn) ${method} ${req.url || "/"} -> ${url} (${upstream.status})`,
      );
      return Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      lastError = error as Error;
      log(`HTTP passthrough failed ${url}: ${lastError.message}`);
    }
  }

  if (!res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Upstream passthrough failed",
        detail: lastError?.message || "unknown error",
      }),
    );
  }
  return "";
}

# Changelog

## [1.0.0] - 2026-06-25

Initial release of `copilot-mock-server` — a fake GitHub Copilot Chat backend for deterministic demo recordings.

### Added

- **HTTP server** with SSE streaming for `/responses`, `/v1/responses`, `/messages`, `/v1/messages`, `/chat/completions`, and `/v1/chat/completions` endpoints
- **WebSocket server** running on the same port, accepting connections and streaming mock responses frame-by-frame
- **Prompt rule matching** — define `input` keyword arrays in a JSON file; the server returns the matched rule's output, preferring the most specific match (most tokens, longest total length)
- **Dual streaming formats** — OpenAI Responses API event stream (WebSocket + SSE) and Chat Completions SSE chunked format, auto-selected by request path
- **Configurable chunk mode** — stream responses token-by-token (`word`) or character-by-character (`char`) with a configurable delay between chunks (`tokenDelayMs`)
- **File link tags** — rules can attach `{ type: "file", path, label }` tags that render as markdown artifact links in the response text; inline `[[file:path|label]]` syntax is also supported in output strings
- **Chat title injection** — rules with a `title` field intercept VS Code Copilot's internal title-generation requests and return a deterministic chat title instead of forwarding to upstream
- **Upstream passthrough** — unmatched requests (HTTP and WebSocket) can be forwarded to the real GitHub Copilot API (`forwardUnmatched: true`); falls back between `fallbackBaseUrl` and `fallbackAltBaseUrl` automatically
- **Configurable logging** — file logging, optional console output, and opt-in request body logging (`logRequestBodies`)
- **CLI entry point** with `-c` / `--config` flag to specify a custom config file path (defaults to `./cms.config.json`)
- **Inline responses** — pass a `responses` array directly in `cms.config.json` instead of a separate mock JSON file
- **Sample config and mock files** (`cms.config.json`, `cms.mock.json`) with example rules covering plain text, markdown, code blocks, file links, tables, and VS Code command URIs

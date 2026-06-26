# Changelog

## [1.0.0] - 2026-06-25

Initial release of `copilot-mock-server` — a local MITM proxy that intercepts GitHub Copilot Chat traffic and replays scripted responses for deterministic demo recordings.

### Added

#### Core proxy

- **HTTPS CONNECT tunnel** — handles `CONNECT` requests so any HTTP/HTTPS proxy-aware client (VS Code, CLI tools) can route traffic through the server without code changes
- **TLS MITM** — terminates HTTPS connections by generating per-host leaf certificates signed by a local CA; certificates are cached in memory for the lifetime of the process
- **Local CA generation** — auto-creates a self-signed CA at `~/.copilot-mock-server/ca.crt` on first run; the CA is reused across restarts and has a 10-year validity

#### Mock engine

- **HTTP server** with SSE streaming for the following endpoints: `/responses`, `/v1/responses`, `/messages`, `/v1/messages`, `/chat/completions`, and `/v1/chat/completions`
- **WebSocket server** running on the same port, accepting connections and streaming mock responses frame-by-frame
- **Prompt rule matching** — define `input` keyword arrays in a JSON rules file; the server returns the matched rule's output, preferring the most specific match (most matched tokens, longest total length)
- **Three streaming wire formats** — OpenAI Responses API event stream (WebSocket + SSE), Chat Completions SSE chunked format, and Anthropic Messages API SSE format; format is auto-selected by request path
- **Configurable chunk mode** — stream responses token-by-token (`word`) or character-by-character (`char`) with a configurable delay between chunks via `tokenDelayMs`
- **File link tags** — rules can attach `{ type: "file", path, label }` tags that render as markdown artifact links in the response text; inline `[[file:path|label]]` syntax is also supported directly in output strings
- **Chat title injection** — rules with a `title` field intercept VS Code Copilot's internal title-generation requests and return a deterministic chat title; falls back to upstream when no title is set
- **Default response** — configurable `defaultResponse` text returned for any prompt that matches no rule (instead of an error)
- **Upstream passthrough** — unmatched HTTP and WebSocket requests are forwarded to the real GitHub Copilot API when `forwardUnmatched: true`; automatically falls back between `fallbackBaseUrl` and `fallbackAltBaseUrl`

#### CLI

- **`copilot-mock-server`** (no subcommand) — starts the mock server; reads config from `./cms.config.json` by default
- **`-c` / `--config <path>`** — specify a custom config file path
- **`-h` / `--help`** — print usage and exit
- **`-v` / `--version`** — print the package version and exit
- **`trust-ca`** — trusts the generated CA cert in the system keychain (macOS: `security add-trusted-cert`; prints manual instructions for Linux and other platforms)
- **`vscode add`** — injects `github.copilot.advanced.debug.overrideProxyUrl`, `overrideCapiUrl`, and `overrideAuthType` into `.vscode/settings.json` to point VS Code Copilot at the mock server; creates the file if it does not exist
- **`vscode remove`** — removes the injected mock settings from `.vscode/settings.json`
- **`wrap <cmd> [args]`** — spawns a command with `HTTPS_PROXY` / `HTTP_PROXY` env vars set to the mock server, so any proxy-aware CLI (e.g. `copilot`) is intercepted without touching its config

#### Configuration

- **`port`** — listening port (default: `3000`)
- **`responsesPath`** — path to the JSON rules file (default: `./cms.mock.json`)
- **`responses`** — inline rules array directly in `cms.config.json`, as an alternative to a separate file
- **`defaultResponse`** — fallback text for unmatched prompts
- **`tokenDelayMs`** — delay in milliseconds between streamed chunks (default: `25`)
- **`chunkBy`** — `"word"` or `"char"` streaming granularity (default: `"word"`)
- **`logFile`** — path to the log file (default: `./copilot-capture.log`)
- **`enableConsoleLogs`** — toggle console output (default: `true`)
- **`logRequestBodies`** — opt-in logging of raw request bodies for debugging (default: `false`)
- **`forwardUnmatched`** — forward unmatched requests to the real Copilot API (default: `false`)
- **`fallbackBaseUrl`** / **`fallbackAltBaseUrl`** — upstream API base URLs tried in order when forwarding

#### Bundled files

- **`cms.config.json`** — sample config with sane defaults
- **`cms.mock.json`** — sample rules file with examples covering plain text, markdown, code blocks, file links, tables, and VS Code command URIs

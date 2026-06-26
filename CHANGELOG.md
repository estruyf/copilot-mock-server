# Changelog

## [1.2.0] - 2026-06-26

### Added

- **Learning mode** (`copilot-mock-server learn`) — proxies all requests to the real Copilot API and records each interaction to `cms.learn.json` as ready-to-use prompt rules; internal utility requests (title generation, branch names, etc.) are forwarded but not recorded
- **`--raw` flag for learn mode** — prints the full raw SSE stream for each recorded interaction to the console, useful for inspecting exact upstream response formats
- **`learnFile` / `learningModeRaw` config options** — configure the learn output file path and raw SSE printing from `cms.config.json`
- **`toolCalls`** field on prompt rules — emit OpenAI Responses API `function_call` output items alongside the text response so VS Code renders tool executions (file creation, edits, etc.)
- **`steps`** field on prompt rules — define a multi-step sequence of text blocks and tool calls to simulate an agent that narrates, calls tools, then narrates again; each step supports its own `delayMs`
- **`outcome`** field on prompt rules — controls what the proxy returns when VS Code sends a follow-up summarization request after a multi-step response completes; falls back to upstream when omitted
- **`delayMs`** field on prompt rules — pause before the response begins streaming, useful for faking a "thinking" delay on single-output rules
- **Placeholder resolution** — `{{cwd}}` and `{{home}}` are substituted at stream time in `toolCalls.arguments` strings and response text, making rules portable across machines and projects
- **Model mirroring** — the model ID from the client request is echoed back in all streamed responses instead of the hardcoded `gpt-mock-1` / `claude-mock-1` strings
- **`-p` / `--port <number>` CLI flag** — override the listening port from the command line without editing the config file
- **Tool-result follow-up suppression** — `function_call_output` (Responses API) and `role: tool` (Chat Completions) follow-up requests now return a silent empty completion instead of leaking the `defaultResponse`
- **Summarization utility detection** — `summarize the following content` requests are now recognised as internal utility requests and, when the last matched rule has an `outcome`, that value is returned instead of forwarding upstream

### Changed

- **Proxy URL order** — the individual endpoint (`api.individual.githubcopilot.com`) is tried first; free/individual-tier tokens work without config changes, and 4xx responses trigger an automatic fallback to the primary team/enterprise URL
- **Expanded utility-pattern matching** — `isInternalUtilityPrompt` now catches any `"please write a brief … for the following request"` variant (branch names, labels, etc.), not just the title-generation phrase

## [1.1.0] - 2026-06-26

### Changed

- **`vscode add` / `vscode remove`** — now uses `jsonc-parser` to make surgical edits to `.vscode/settings.json`; comments, formatting, and all unrelated settings are preserved instead of being rewritten

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

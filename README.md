# Fake GitHub Copilot Chat Backend

A TypeScript mock server that intercepts GitHub Copilot Chat requests and returns deterministic, scripted responses. Useful for demos, recordings, and testing Copilot-integrated tooling without hitting the real API.

Supports both transports Copilot can use:

- WebSocket
- HTTP POST with `text/event-stream`

Also works as an **HTTPS interception proxy** — Copilot CLI and other tools that respect `HTTPS_PROXY` can be pointed at the server directly without any VS Code settings changes.

## Quick Start

**Via npx (no install required):**

```bash
npx copilot-mock-server
```

**Global install:**

```bash
npm i -g copilot-mock-server
copilot-mock-server
```

**Local development:**

```bash
npm install
npm start
```

Server defaults to `http://localhost:3000` and reads config from `./cms.config.json` in the current directory.

## Commands

```
copilot-mock-server [command] [options]

Commands:
  (none)              Start the mock server (default)
  vscode add          Inject proxy settings into .vscode/settings.json
  vscode remove       Remove proxy settings from .vscode/settings.json
  trust-ca            Trust the generated CA cert in the system keychain
  wrap <cmd> [args]   Run a command with HTTPS_PROXY pointed at the mock server

Options:
  -c, --config <path>   Path to config file (default: ./cms.config.json)
  -h, --help            Show help
  -v, --version         Print version number
```

## Configuration

The server is configured via `cms.config.json` (the default) or a file you specify with `-c`/`--config`:

```bash
# npx
npx copilot-mock-server -c ./path/to/my-config.json

# global
copilot-mock-server -c ./path/to/my-config.json

# local
npm start -- -c ./path/to/my-config.json
```

All fields are optional — omitted fields fall back to the defaults shown below.

### `cms.config.json` reference

```json
{
  "port": 3000,
  "responsesPath": "./cms.mock.json",
  "defaultResponse": "I am running in mocked mode.",
  "tokenDelayMs": 25,
  "chunkBy": "word",
  "logFile": "./copilot-capture.log",
  "enableConsoleLogs": true,
  "logRequestBodies": false,
  "forwardUnmatched": false,
  "fallbackBaseUrl": "https://api.githubcopilot.com",
  "fallbackAltBaseUrl": "https://api.individual.githubcopilot.com"
}
```

| Field | Default | Description |
|---|---|---|
| `port` | `3000` | Port the server listens on |
| `responsesPath` | `./cms.mock.json` | Path to the JSON prompt rules file |
| `responses` | — | Inline prompt rules array (overrides `responsesPath` when set) |
| `defaultResponse` | *(see above)* | Response text when no rule matches |
| `tokenDelayMs` | `25` | Delay between streamed tokens in milliseconds |
| `chunkBy` | `"word"` | Stream by `"word"` or `"char"` |
| `logFile` | `./copilot-capture.log` | Path to the log file |
| `enableConsoleLogs` | `true` | Set to `false` to mute console output (log file still written) |
| `logRequestBodies` | `false` | Set to `true` to log full HTTP bodies and WebSocket frames |
| `forwardUnmatched` | `false` | Set to `true` to proxy unmatched prompts to the real Copilot API |
| `fallbackBaseUrl` | `https://api.githubcopilot.com` | Primary upstream URL used when forwarding |
| `fallbackAltBaseUrl` | `https://api.individual.githubcopilot.com` | Alternate upstream URL used when forwarding |

> Keep `logRequestBodies` set to `false` during demos for better streaming performance.

### Inline responses

Instead of pointing to a separate rules file, you can embed rules directly in the config:

```json
{
  "responses": [
    { "input": ["hello"], "output": "Hi from inline config" }
  ]
}
```

When `responses` is set it takes precedence over `responsesPath`.

## Prompt Rules Format

Rules are loaded from the file at `responsesPath` (or from the inline `responses` field). Each rule defines keywords to match and the response to return:

```json
[
  {
    "input": ["joke"],
    "title": "Developer Joke",
    "output": "Why did the developer go broke? Because he used up all his cache."
  },
  {
    "input": ["Let me check if this is working with Demo Time"],
    "output": "Yes, it seems to be working with Demo Time."
  },
  {
    "input": ["Can you create a `test.json` file?"],
    "output": {
      "text": "Created [[file:test.json]] with your content in JSON format.",
      "tags": [
        {
          "type": "file",
          "path": "test.json",
          "label": "test.json"
        }
      ]
    }
  }
]
```

### Rule matching

- All entries in `input` must appear in the user prompt (case-insensitive) for a rule to match.
- Single-word entries are matched as whole tokens; multi-word entries are matched as substrings.
- When multiple rules match, the most specific one wins: most required tokens first, then longest total token length, then document order.
- If no rule matches and `forwardUnmatched` is `false`, `defaultResponse` is returned.
- If no rule matches and `forwardUnmatched` is `true`, the request is proxied to the real Copilot API.

### Chat title generation

When VS Code opens a new chat it sends an internal title-generation request on `/chat/completions`. If the matched rule has a `title` field, that value is returned as the chat title. If not, the request is forwarded upstream so VS Code can generate a real title.

## Output Tags (Clickable File Links)

Responses can include clickable file links rendered as markdown. Two syntaxes are supported:

**Inline tag in output text:**

```
[[file:path/to/file.ext]]
[[file:path/to/file.ext|Label]]
```

**Structured tags in `output.tags`:**

```json
{
  "text": "Here is your file.",
  "tags": [
    { "type": "file", "path": "path/to/file.ext", "label": "Open file" }
  ]
}
```

Both render as markdown links in the chat response.

## VS Code Copilot Override Settings

Use the built-in commands to inject or remove the required settings automatically. Settings are written to `.vscode/settings.json` in the current directory, so they only apply to the open workspace.

```bash
# Add settings to .vscode/settings.json
copilot-mock-server vscode add

# Remove them again
copilot-mock-server vscode remove
```

Pass `-c` to pick up the port from a custom config file:

```bash
copilot-mock-server vscode add -c ./my-config.json
```

Reload your VS Code window after running either command for the changes to take effect in the current session.

### Manual setup

If you prefer to add the settings by hand, add them to `.vscode/settings.json`:

```json
{
  "github.copilot.advanced.debug.overrideProxyUrl": "http://localhost:3000",
  "github.copilot.advanced.debug.overrideCapiUrl": "http://localhost:3000",
  "github.copilot.advanced.debug.overrideAuthType": "token"
}
```

## HTTPS Proxy (Copilot CLI and other tools)

The server also works as a full HTTPS interception proxy for any tool that respects `HTTPS_PROXY` — including the Copilot CLI. Non-Copilot traffic (GitHub auth, `api.github.com`, etc.) is forwarded transparently to the real servers.

### One-time CA setup

The server generates a self-signed CA certificate the first time it starts, stored at `~/.copilot-mock-server/ca.crt`. Trust it once:

```bash
copilot-mock-server trust-ca
```

This runs `sudo security add-trusted-cert` on macOS, or prints the equivalent command on Linux. On any platform you can also trust it per-process via the `NODE_EXTRA_CA_CERTS` environment variable (see below).

### Using the `wrap` command

`wrap` starts any command with `HTTPS_PROXY` already set to the mock server's address. The port is read from the config file, so `-c` works too:

```bash
# Start the mock server
copilot-mock-server

# In another terminal — wrap copilot
copilot-mock-server wrap copilot

# With a custom config
copilot-mock-server -c ./my-config.json wrap copilot
```

`wrap` sets all four proxy environment variables (`HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`) so the proxied process picks them up regardless of case.

### Manual proxy setup

If you prefer to set the environment variable yourself:

```bash
HTTPS_PROXY=http://localhost:3000 copilot
```

### Without system trust (per-process)

If you don't want to trust the CA system-wide, pass it directly to the target process:

```bash
NODE_EXTRA_CA_CERTS="$HOME/.copilot-mock-server/ca.crt" copilot-mock-server wrap copilot
```

Or manually:

```bash
NODE_EXTRA_CA_CERTS="$HOME/.copilot-mock-server/ca.crt" HTTPS_PROXY=http://localhost:3000 copilot
```

# Fake GitHub Copilot Chat Backend

A TypeScript mock server that intercepts GitHub Copilot Chat requests and returns deterministic, scripted responses. Useful for demos, recordings, and testing Copilot-integrated tooling without hitting the real API.

Supports both transports Copilot can use:

- WebSocket
- HTTP POST with `text/event-stream`

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
    "input": ["kubernetes", "yaml"],
    "title": "Kubernetes YAML Template",
    "output": "Here is a Kubernetes YAML template..."
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

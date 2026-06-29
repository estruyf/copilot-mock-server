# GitHub Copilot Mock Server aka `copilot-mock-server`

A TypeScript mock server that intercepts GitHub Copilot Chat requests and returns deterministic, scripted responses. Useful for demos, recordings, and testing Copilot-integrated tooling without hitting the real API.

Supports both transports Copilot can use:

- WebSocket
- HTTP POST with `text/event-stream`

Also works as an **HTTPS interception proxy** — Copilot CLI and other tools that respect `HTTPS_PROXY` can be pointed at the server directly without any VS Code settings changes.

## Samples

Looking for real-world examples? Check out [demo-time-github-copilot-mocking](https://github.com/estruyf/demo-time-github-copilot-mocking) — a repository with Demo Time samples showing how to use this proxy for scripted demos.

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
  list                List all loaded mock rules and exit
  learn               Start in learning mode — proxy and record real responses
  learn --raw         Learning mode + print the raw SSE stream for each response
  vscode add          Inject proxy settings into .vscode/settings.json
  vscode remove       Remove proxy settings from .vscode/settings.json
  trust-ca            Trust the generated CA cert in the system keychain
  wrap <cmd> [args]   Run a command with HTTPS_PROXY pointed at the mock server

Options:
  -c, --config <path>   Path to config file (default: ./cms.config.json)
  -p, --port <number>   Override the port (default: 3000)
  --raw                 Print raw SSE output (only applies to learn command)
  -h, --help            Show help
  -v, --version         Print version number
```

## Listing Rules

Run `list` to print every loaded rule and exit — useful for verifying your mock file is parsed correctly before a demo:

```bash
copilot-mock-server list
copilot-mock-server list -c ./my-config.json
```

Output shows each rule's input tokens, output type, and (for sequences) a preview of every item:

```
  copilot-mock-server  v1.3.0
  ────────────────────────────────────────────────────────
  Config     ./cms.config.json
  Responses  ./cms.mock.json

  3 rules loaded

  1  "kubernetes", "yaml"   → "Here is a Kubernetes YAML template..."
  2  "joke"                 → "Why did the developer go broke?..."
  3  "status"               → [sequence: 3 items]
       [0] "Checking the pipeline… one moment."
       [1] "Tests are running, 3 of 12 complete."
       [2] "All 12 tests passed. Pipeline is green."
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

By default, `responsesPath` points to `./cms.mock.json`.

The server watches the config file for changes and reloads automatically — no restart required when editing `cms.config.json`. Sequence counters (see [Response sequences](#response-sequences)) are reset on every reload.

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
| `learningMode` | `false` | Set to `true` to record real Copilot responses to `learnFile` instead of mocking |
| `learnFile` | `./cms.learn.json` | Path to the file where learned responses are written |
| `learningModeRaw` | `false` | Set to `true` to also print the raw SSE stream to the console for each recorded interaction |

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

Rules are loaded from the file at `responsesPath` (or from the inline `responses` field). Each rule defines keywords to match and the response to return.

### Simple text response

```json
[
  {
    "input": ["joke"],
    "title": "Developer Joke",
    "output": "Why did the developer go broke? Because he used up all his cache."
  }
]
```

### Response with a startup delay

Use `delayMs` to pause before the response starts streaming. This is useful for faking a "thinking" pause on a single-output rule:

```json
{
  "input": ["joke"],
  "output": "Why did the developer go broke? Because he used up all his cache.",
  "delayMs": 1500
}
```

### Response with tool calls

Use `toolCalls` to emit function-call output items alongside the text. VS Code renders these as the agent executing tools (file creation, edits, etc.):

```json
{
  "input": ["create", "test.json"],
  "output": "Created [test.json](test.json) with some dummy content.",
  "toolCalls": [
    {
      "name": "create_file",
      "arguments": "{\"filePath\":\"{{cwd}}/test.json\",\"content\":\"{\\\"hello\\\":\\\"world\\\"}\"}"
    }
  ]
}
```

> Tools can be found in the [toolNames.ts](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/tools/common/toolNames.ts) file in the VS Code repo. 
> You can also discover them by running the `copilot-mock-server` in learning mode and inspecting the `toolCalls` in the recorded responses.

#### Placeholders

Tool call arguments and response text often need absolute file paths, which differ between machines and projects. Use these placeholders in `arguments` strings and `text` fields — they are resolved at stream time:

| Placeholder | Resolved value |
|---|---|
| `{{cwd}}` | The server's current working directory (i.e. the project root) |
| `{{home}}` | The current user's home directory |

### Multi-step response (faking thinking)

Use `steps` to emit a sequence of message and tool-call output items, simulating an agent that narrates, calls tools, then narrates again. Each step can have its own `delayMs` to add a pause before that step begins.

```json
{
  "input": ["create a sample typescript file"],
  "steps": [
    {
      "text": "Let me check what I can use for the sample TypeScript file.",
      "delayMs": 200
    },
    {
      "text": "Creating the TypeScript file now.",
      "delayMs": 300,
      "toolCalls": [
        {
          "name": "create_file",
          "arguments": "{\"filePath\":\"{{cwd}}/add.ts\",\"content\":\"export function add(a: number, b: number): number {\\n  return a + b;\\n}\\n\"}"
        }
      ]
    }
  ],
  "outcome": "Created add.ts"
}
```

The optional `outcome` field controls what the proxy returns when the client sends a follow-up summarization request after the steps complete (e.g. "Summarize the following content in a single sentence…"). If `outcome` is defined, its value is streamed back as the summary — placeholders like `{{cwd}}` are resolved at that point. If `outcome` is omitted, the summarization request is forwarded to the real upstream so the client can generate its own summary.

The `steps` field overrides `output` and `toolCalls` when present. Steps are emitted as separate `response.output_item` events — each text block and each tool call is its own output item. The `delayMs` on a step pauses before that step's first frame, so the loading spinner appears immediately but content arrives after the delay.

### Response sequences

Use `sequence` to cycle through different outputs each time a rule is matched. On the first match the first item is returned, on the second match the second item, and so on — wrapping back to the start after the last item. This is useful for demos that show a progression of responses to the same prompt.

```json
{
  "input": ["status"],
  "sequence": [
    "Checking the pipeline… one moment.",
    "Tests are running, 3 of 12 complete.",
    "All 12 tests passed. Pipeline is green."
  ]
}
```

Each item in the sequence supports the same forms as a regular rule output — a plain string, an object with `text` and optional `tags`/`toolCalls`, or an object with `steps`:

```json
{
  "input": ["deploy"],
  "sequence": [
    { "text": "Starting deployment…", "delayMs": 0 },
    {
      "steps": [
        { "text": "Building image.", "delayMs": 300 },
        { "text": "Pushing to registry.", "delayMs": 500 }
      ]
    },
    "Deployment complete. Version 1.4.2 is live."
  ]
}
```

Sequence counters are per-rule and live in memory for the duration of the server process. They reset whenever the config file is reloaded (see [Configuration](#configuration)).

### Clickable file links

Responses can include clickable file links rendered as markdown. Two syntaxes are supported:

**Inline tag in output text:**

```
[[file:path/to/file.ext]]
[[file:path/to/file.ext|Label]]
```

**Structured tags in `output.tags`:**

```json
{
  "input": ["check", "working"],
  "output": {
    "text": "Created [[file:test.json]] with your content in JSON format.",
    "tags": [
      { "type": "file", "path": "test.json", "label": "test.json" }
    ]
  }
}
```

Both render as markdown links in the chat response.

### Rule matching

- All entries in `input` must appear in the user prompt (case-insensitive) for a rule to match.
- Single-word entries are matched as whole tokens; multi-word entries are matched as substrings.
- When multiple rules match, the most specific one wins: most required tokens first, then longest total token length, then document order.
- If no rule matches and `forwardUnmatched` is `false`, `defaultResponse` is returned.
- If no rule matches and `forwardUnmatched` is `true`, the request is proxied to the real Copilot API.

### Chat title generation

When VS Code opens a new chat it sends an internal title-generation request on `/chat/completions`. If the matched rule has a `title` field, that value is returned as the chat title. If not, the request is forwarded upstream so VS Code can generate a real title.

## Learning Mode

Learning mode records real Copilot responses so you can replay them later without hitting the API.

```bash
copilot-mock-server learn
```

All requests are forwarded to the real Copilot API. Each response is written to the learn file (`./cms.learn.json` by default) as a ready-to-use prompt rule. Internal utility requests such as chat title and branch name generation are forwarded but not recorded.

Once you have captured what you need, stop the server and copy entries from the learn file into your mock rules file (the one pointed to by `responsesPath`).

### Learn file format

Each recorded interaction is written as a single `PromptRule` entry. The full prompt text is stored as a single-element `input` array so it is easy to read and trim down to keywords:

```json
[
  {
    "input": ["Create me a demo yaml file with some fake content."],
    "output": "Here is a sample YAML file:\n\n```yaml\nname: demo\n..."
  }
]
```

Edit the `input` array to the keywords you actually want to match on before using the file as a mock.

### Raw output

Pass `--raw` to also print the raw SSE stream for each recorded interaction directly to the console. This is useful for inspecting the exact response format coming from the upstream API:

```bash
copilot-mock-server learn --raw
```

Each interaction will show the normal recording summary followed by the full SSE body:

```
  ◉ LEARN  "Create me a demo yaml file with some fake content."
           1234 chars → /path/to/cms.learn.json

  RAW SSE
  ────────────────────────────────────────────────────────────
  event: response.created
  data: {"type":"response.created","response":{...}}
  event: response.output_text.delta
  data: {"type":"response.output_text.delta","delta":"Here",...}
  ...
  ────────────────────────────────────────────────────────────
```

### Config options

The learn file path and raw mode can also be set in `cms.config.json`:

```json
{
  "learningMode": true,
  "learnFile": "./cms.learn.json",
  "learningModeRaw": false
}
```

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

<p align="center">
  <a href="https://visitorbadge.io/status?path=https%3A%2F%2Fgithub.com%2Festruyf%2Fcopilot-mock-server"><img src="https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Fgithub.com%2Festruyf%2Fcopilot-mock-server&countColor=%23263759" /></a>
</p>
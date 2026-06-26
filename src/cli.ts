#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startServer } from "./server.js";
import { addVSCodeSettings, removeVSCodeSettings } from "./vscode.js";
import { initConfig, CONFIG } from "./config.js";
import { caPath } from "./cert.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const HELP = `
Usage: copilot-mock-server [command] [options]

Commands:
  (none)              Start the mock server (default)
  learn               Start in learning mode — proxy all requests and record
                      responses to cms.learn.json for use as mock rules
                      Use --raw to also print the raw SSE stream to the console
  vscode add          Inject proxy settings into .vscode/settings.json
  vscode remove       Remove proxy settings from .vscode/settings.json
  trust-ca            Trust the generated CA cert in the system keychain
  wrap <cmd> [args]   Start the mock server and run a command with HTTPS_PROXY pointed at it

Options:
  -c, --config <path>   Path to config file (default: ./cms.config.json)
  -p, --port <number>   Override the port (default: 3000)
  -h, --help            Show this help message
  -v, --version         Print version number

Examples:
  copilot-mock-server
  copilot-mock-server learn
  copilot-mock-server wrap copilot
  copilot-mock-server --port 8080 wrap copilot
  copilot-mock-server -c ./my-config.json wrap copilot
`.trim();

const args = process.argv.slice(2);

let configPath = "./cms.config.json";
let portOverride: number | undefined;
let rawMode = false;
const positional: string[] = [];
let wrapArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-h" || args[i] === "--help") {
    console.log(HELP);
    process.exit(0);
  } else if (args[i] === "-v" || args[i] === "--version") {
    console.log(version);
    process.exit(0);
  } else if ((args[i] === "-c" || args[i] === "--config") && args[i + 1]) {
    configPath = args[++i];
  } else if ((args[i] === "-p" || args[i] === "--port") && args[i + 1]) {
    const parsed = parseInt(args[++i], 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port: ${args[i]}`);
      process.exit(1);
    }
    portOverride = parsed;
  } else if (args[i] === "--raw") {
    rawMode = true;
  } else if (args[i] === "wrap") {
    wrapArgs = args.slice(i + 1);
    positional.push("wrap");
    break;
  } else {
    positional.push(args[i]);
  }
}

const [command, subcommand] = positional;

if (command === "wrap") {
  if (wrapArgs.length === 0) {
    console.error("Usage: copilot-mock-server wrap <command> [args...]");
    process.exit(1);
  }
  initConfig(configPath);
  const port = portOverride ?? CONFIG.port;
  const proxyUrl = `http://localhost:${port}`;
  const [cmd, ...cmdArgs] = wrapArgs;
  const child = spawn(cmd, cmdArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      HTTPS_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      NODE_EXTRA_CA_CERTS: caPath(),
    },
  });
  child.on("error", (err) => {
    console.error(`wrap: failed to start "${cmd}": ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
} else if (command === "trust-ca") {
  const ca = caPath();
  console.log(`CA cert: ${ca}\n`);
  if (process.platform === "darwin") {
    try {
      execSync(
        `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${ca}"`,
        { stdio: "inherit" },
      );
      console.log("\nCA cert trusted. Restart any apps that use the proxy.");
    } catch {
      console.error("Failed. Run manually:");
      console.error(
        `  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${ca}"`,
      );
    }
  } else if (process.platform === "linux") {
    console.log("To trust on Ubuntu/Debian:");
    console.log(
      `  sudo cp "${ca}" /usr/local/share/ca-certificates/copilot-mock-server.crt`,
    );
    console.log("  sudo update-ca-certificates");
  } else {
    console.log("Add the cert to your system trust store, or use:");
    console.log(`  NODE_EXTRA_CA_CERTS="${ca}" <command>`);
  }
} else if (command === "vscode") {
  initConfig(configPath);
  const port = portOverride ?? CONFIG.port;
  if (subcommand === "add") {
    await addVSCodeSettings(port);
  } else if (subcommand === "remove") {
    removeVSCodeSettings();
  } else {
    console.error("Usage: copilot-mock-server vscode <add|remove>");
    process.exit(1);
  }
} else if (command === "learn") {
  startServer(configPath, {
    ...(portOverride !== undefined ? { port: portOverride } : {}),
    learningMode: true,
    learningModeRaw: rawMode,
  });
} else {
  startServer(
    configPath,
    portOverride !== undefined ? { port: portOverride } : undefined,
  );
}

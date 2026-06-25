#!/usr/bin/env node
import { startServer } from "./server.js";
import { addVSCodeSettings, removeVSCodeSettings } from "./vscode.js";
import { initConfig, CONFIG } from "./config.js";

const args = process.argv.slice(2);

let configPath = "./cms.config.json";
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "-c" || args[i] === "--config") && args[i + 1]) {
    configPath = args[++i];
  } else {
    positional.push(args[i]);
  }
}

const [command, subcommand] = positional;

if (command === "vscode") {
  initConfig(configPath);
  if (subcommand === "add") {
    await addVSCodeSettings(CONFIG.port);
  } else if (subcommand === "remove") {
    removeVSCodeSettings();
  } else {
    console.error("Usage: copilot-mock-server vscode <add|remove>");
    process.exit(1);
  }
} else {
  startServer(configPath);
}

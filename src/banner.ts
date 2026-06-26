import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

function lbl(text: string): string {
  return `${DIM}${text.padEnd(12)}${R}`;
}

export function printBanner(opts: {
  port: number;
  configPath: string;
  responsesSrc: string;
  caCertPath: string;
  ruleCount: number;
}): void {
  const { port, configPath, responsesSrc, caCertPath, ruleCount } = opts;
  const sep = `${DIM}${"─".repeat(52)}${R}`;
  const rules = `${ruleCount} rule${ruleCount !== 1 ? "s" : ""}`;

  const lines = [
    "",
    `  ${BOLD}${CYAN}copilot-mock-server${R}  ${DIM}v${version}${R}`,
    `  ${sep}`,
    "",
    `  ${GREEN}●${R}  ${lbl("HTTP")}${BOLD}http://localhost:${port}${R}`,
    `  ${GREEN}●${R}  ${lbl("WebSocket")}${BOLD}ws://localhost:${port}${R}`,
    "",
    `  ${lbl("Config")}${configPath}`,
    `  ${lbl("Responses")}${responsesSrc}  ${DIM}(${rules})${R}`,
    `  ${lbl("CA cert")}${caCertPath}`,
    "",
    `  ${YELLOW}Hint${R}  Trust the CA : ${BOLD}copilot-mock-server trust-ca${R}`,
    `        Or set env  : ${DIM}NODE_EXTRA_CA_CERTS="${caCertPath}" <command>${R}`,
    "",
    `  ${sep}`,
    `  ${DIM}Press Ctrl+C to stop${R}`,
    "",
  ];

  process.stdout.write(lines.join("\n") + "\n");
}

import fs from "node:fs";
import path from "node:path";
import type { Config } from "./types.js";

export const DEFAULTS: Config = {
  port: 3000,
  responsesPath: "./cms.mock.json",
  defaultResponse:
    "This is a mocked response. Add a prompt rule in your config file to customize this.",
  tokenDelayMs: 25,
  chunkBy: "word",
  logFile: "./copilot-capture.log",
  enableConsoleLogs: true,
  logRequestBodies: false,
  forwardUnmatched: false,
  fallbackBaseUrl: "https://api.githubcopilot.com",
  fallbackAltBaseUrl: "https://api.individual.githubcopilot.com",
  learningMode: false,
  learnFile: "./cms.learn.json",
  learningModeRaw: false,
};

export let CONFIG: Config = { ...DEFAULTS };

export function initConfig(configPath: string): void {
  const resolved = path.resolve(configPath);
  try {
    const raw = fs.readFileSync(resolved, "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    const chunkBy =
      parsed.chunkBy === "char" || parsed.chunkBy === "word"
        ? parsed.chunkBy
        : DEFAULTS.chunkBy;
    CONFIG = { ...DEFAULTS, ...parsed, chunkBy };
  } catch {
    CONFIG = { ...DEFAULTS };
  }
}

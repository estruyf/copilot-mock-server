import fs from "node:fs";
import crypto from "node:crypto";
import { CONFIG } from "./config.js";

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const rid = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

export function log(...parts: string[]) {
  const line = `[${new Date().toISOString()}] ${parts.join(" ")}`;
  if (CONFIG.enableConsoleLogs) {
    console.log(line);
  }
  try {
    fs.appendFileSync(CONFIG.logFile, `${line}\n`, "utf8");
  } catch {
    // ignore log write errors
  }
}

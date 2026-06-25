import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const MOCK_KEYS = [
  "github.copilot.advanced.debug.overrideProxyUrl",
  "github.copilot.advanced.debug.overrideCapiUrl",
  "github.copilot.advanced.debug.overrideAuthType",
] as const;

const SETTINGS_PATH = path.join(process.cwd(), ".vscode/settings.json");

const ALLOWED_ROOTS = [os.homedir(), process.cwd()];

function assertAllowedPath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const allowed = ALLOWED_ROOTS.some((root) =>
    resolved.startsWith(path.resolve(root) + path.sep),
  );
  if (!allowed) {
    throw new Error(`Refusing to access path outside allowed directories: ${resolved}`);
  }
}

function readJson(filePath: string): Record<string, unknown> {
  assertAllowedPath(filePath);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    // VS Code settings.json is JSONC — strip line and block comments before parsing.
    const stripped = raw
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  assertAllowedPath(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function addVSCodeSettings(port: number): Promise<void> {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.log(`No .vscode/settings.json found at: ${SETTINGS_PATH}`);
    const ok = await confirm("Create it now? (y/n) ");
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  const settings = readJson(SETTINGS_PATH);
  const baseUrl = `http://localhost:${port}`;

  settings["github.copilot.advanced.debug.overrideProxyUrl"] = baseUrl;
  settings["github.copilot.advanced.debug.overrideCapiUrl"] = baseUrl;
  settings["github.copilot.advanced.debug.overrideAuthType"] = "token";

  writeJson(SETTINGS_PATH, settings);
  console.log(`Updated: ${SETTINGS_PATH}`);
  console.log("\nReload your VS Code window to activate the mock server for this session.");
  console.log("Run `copilot-mock-server vscode remove` to undo.");
}

export function removeVSCodeSettings(): void {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.log("No .vscode/settings.json found — nothing to remove.");
    return;
  }

  const settings = readJson(SETTINGS_PATH);
  const before = Object.keys(settings).length;

  for (const key of MOCK_KEYS) {
    delete settings[key];
  }

  if (Object.keys(settings).length < before) {
    writeJson(SETTINGS_PATH, settings);
    console.log(`Removed mock settings from: ${SETTINGS_PATH}`);
  } else {
    console.log(`No mock settings found in: ${SETTINGS_PATH}`);
  }

  console.log("\nReload your VS Code window for the changes to take effect.");
}

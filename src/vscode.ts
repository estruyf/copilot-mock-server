import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { applyEdits, modify, parse } from "jsonc-parser";

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
    throw new Error(
      `Refusing to access path outside allowed directories: ${resolved}`,
    );
  }
}

function readRaw(filePath: string): string {
  assertAllowedPath(filePath);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "{}";
  }
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
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

  assertAllowedPath(SETTINGS_PATH);

  const baseUrl = `http://localhost:${port}`;
  const newValues: Record<string, string> = {
    "github.copilot.advanced.debug.overrideProxyUrl": baseUrl,
    "github.copilot.advanced.debug.overrideCapiUrl": baseUrl,
    "github.copilot.advanced.debug.overrideAuthType": "token",
  };

  let raw = fs.existsSync(SETTINGS_PATH) ? readRaw(SETTINGS_PATH) : "{}";

  // Apply each key surgically, preserving existing content and comments.
  for (const [key, value] of Object.entries(newValues)) {
    const edits = modify(raw, [key], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    raw = applyEdits(raw, edits);
  }

  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, raw, "utf8");
  console.log(`Updated: ${SETTINGS_PATH}`);
  console.log(
    "\nReload your VS Code window to activate the mock server for this session.",
  );
  console.log("Run `copilot-mock-server vscode remove` to undo.");
}

export function removeVSCodeSettings(): void {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.log("No .vscode/settings.json found — nothing to remove.");
    return;
  }

  assertAllowedPath(SETTINGS_PATH);

  let raw = readRaw(SETTINGS_PATH);
  const parsed = parse(raw) as Record<string, unknown>;
  let removed = 0;

  for (const key of MOCK_KEYS) {
    if (key in parsed) {
      const edits = modify(raw, [key], undefined, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      raw = applyEdits(raw, edits);
      removed++;
    }
  }

  if (removed > 0) {
    fs.writeFileSync(SETTINGS_PATH, raw, "utf8");
    console.log(`Removed mock settings from: ${SETTINGS_PATH}`);
  } else {
    console.log(`No mock settings found in: ${SETTINGS_PATH}`);
  }

  console.log("\nReload your VS Code window for the changes to take effect.");
}

import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";
import { log } from "./logger.js";
import type { NormalizedStep, PromptRule, ToolCall } from "./types.js";

const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const R = "\x1b[0m";

export type ApiPathType = "responses" | "chat" | "anthropic";


function extractStepsFromEvents(events: Record<string, unknown>[]): NormalizedStep[] {
  // Collect ordered output items from response.output_item.done events
  const byIndex = new Map<number, { type: string; text?: string; name?: string; arguments?: string }>();

  for (const obj of events) {
    if (obj.type !== "response.output_item.done") continue;
    const idx = Number(obj.output_index ?? 0);
    const item = obj.item as Record<string, unknown> | undefined;
    if (!item) continue;

    if (item.type === "message") {
      const content = item.content as Array<Record<string, unknown>> | undefined;
      const text = Array.isArray(content)
        ? content
            .filter((c) => c.type === "output_text")
            .map((c) => String(c.text || ""))
            .join("")
        : "";
      byIndex.set(idx, { type: "message", text });
    } else if (item.type === "function_call") {
      byIndex.set(idx, {
        type: "function_call",
        name: String(item.name || ""),
        arguments: String(item.arguments || ""),
      });
    }
  }

  // Walk items in index order; each message starts a new step, function calls attach to the current step
  const sorted = [...byIndex.entries()].sort(([a], [b]) => a - b);
  const steps: NormalizedStep[] = [];
  let current: NormalizedStep | null = null;

  for (const [, item] of sorted) {
    if (item.type === "message") {
      if (current) steps.push(current);
      current = { text: item.text ?? "", toolCalls: [], delayMs: 0 };
    } else if (item.type === "function_call" && item.name) {
      if (!current) current = { text: "", toolCalls: [], delayMs: 0 };
      current.toolCalls.push({ name: item.name, arguments: item.arguments ?? "" });
    }
  }
  if (current) steps.push(current);

  return steps;
}

function extractChatSteps(body: string): NormalizedStep[] {
  // Chat Completions: single text block + optional tool calls (no multi-step)
  const textParts: string[] = [];
  const tcAcc = new Map<number, { name: string; args: string }>();
  const toolCalls: ToolCall[] = [];

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    const choices = obj.choices as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(choices) || !choices[0]) continue;
    const delta = choices[0].delta as Record<string, unknown> | undefined;

    if (typeof delta?.content === "string" && delta.content) {
      textParts.push(delta.content);
    }

    const tcs = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(tcs)) {
      for (const tc of tcs) {
        const idx = Number(tc.index ?? 0);
        if (!tcAcc.has(idx)) tcAcc.set(idx, { name: "", args: "" });
        const entry = tcAcc.get(idx)!;
        const fn = tc.function as Record<string, unknown> | undefined;
        if (fn?.name) entry.name = String(fn.name);
        if (fn?.arguments) entry.args += String(fn.arguments);
      }
    }

    const finishReason = choices[0].finish_reason as string | undefined;
    if (finishReason === "tool_calls" || finishReason === "stop") {
      for (const [, tc] of tcAcc) {
        if (tc.name) toolCalls.push({ name: tc.name, arguments: tc.args });
      }
      tcAcc.clear();
    }
  }

  for (const [, tc] of tcAcc) {
    if (tc.name) toolCalls.push({ name: tc.name, arguments: tc.args });
  }

  const text = textParts.join("");
  if (!text && toolCalls.length === 0) return [];
  return [{ text, toolCalls, delayMs: 0 }];
}

function extractStepsFromSSE(body: string, pathType: ApiPathType): NormalizedStep[] {
  if (pathType === "chat") return extractChatSteps(body);
  if (pathType === "anthropic") {
    // Anthropic: simple single text block, no step structure
    const parts: string[] = [];
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        if (obj.type === "content_block_delta") {
          const delta = obj.delta as Record<string, unknown> | undefined;
          if (typeof delta?.text === "string") parts.push(delta.text);
        }
      } catch { /* skip */ }
    }
    const text = parts.join("");
    return text ? [{ text, toolCalls: [], delayMs: 0 }] : [];
  }

  // Responses API: parse events and reconstruct ordered steps
  const events: Record<string, unknown>[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") continue;
    try {
      events.push(JSON.parse(raw) as Record<string, unknown>);
    } catch { /* skip */ }
  }
  return extractStepsFromEvents(events);
}

function saveInteraction(prompt: string, steps: NormalizedStep[]): void {
  if (steps.length === 0) {
    log("LEARN nothing useful extracted from upstream response — skipping");
    return;
  }

  const learnFilePath = path.resolve(CONFIG.learnFile);
  let existing: PromptRule[] = [];
  try {
    const raw = fs.readFileSync(learnFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) existing = parsed as PromptRule[];
  } catch {
    // fresh start
  }

  // Single step with no tool calls → simple { output } form for readability
  // Everything else → { steps } form
  let entry: PromptRule;
  if (steps.length === 1 && steps[0].toolCalls.length === 0) {
    entry = { input: [prompt.trim()], output: steps[0].text };
  } else if (steps.length === 1) {
    entry = { input: [prompt.trim()], output: steps[0].text, toolCalls: steps[0].toolCalls };
  } else {
    entry = { input: [prompt.trim()], steps };
  }
  existing.push(entry);

  const totalToolCalls = steps.reduce((n, s) => n + s.toolCalls.length, 0);
  const totalChars = steps.reduce((n, s) => n + s.text.length, 0);
  const note =
    steps.length > 1
      ? `${steps.length} steps, ${totalToolCalls} tool call(s)`
      : totalToolCalls > 0
        ? `${totalChars} chars + ${totalToolCalls} tool call(s)`
        : `${totalChars} chars`;

  try {
    fs.writeFileSync(learnFilePath, JSON.stringify(existing, null, 2), "utf8");
    const short = prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt;
    log(`LEARN recorded "${short}" → ${note}`);
    process.stdout.write(
      `\n  ${YELLOW}◉ LEARN${R}  ${BOLD}"${short}"${R}\n` +
        `           ${DIM}${note} → ${CYAN}${learnFilePath}${R}\n\n`,
    );
  } catch (error) {
    log(`LEARN write failed: ${(error as Error).message}`);
  }
}

function printRaw(lines: string[], label: string): void {
  const sep = `${DIM}${"─".repeat(52)}${R}`;
  process.stdout.write(`\n  ${DIM}RAW ${label}${R}\n  ${sep}\n`);
  for (const line of lines) {
    if (line.trim()) process.stdout.write(`  ${DIM}${line}${R}\n`);
  }
  process.stdout.write(`  ${sep}\n\n`);
}

export function recordInteraction(
  prompt: string,
  sseBody: string,
  pathType: ApiPathType,
): void {
  const steps = extractStepsFromSSE(sseBody, pathType);
  saveInteraction(prompt, steps);
  if (CONFIG.learningModeRaw) {
    printRaw(sseBody.split("\n"), "SSE");
  }
}

export function recordInteractionFromWsFrames(
  prompt: string,
  frames: string[],
): void {
  const events: Record<string, unknown>[] = [];
  for (const frame of frames) {
    try {
      events.push(JSON.parse(frame) as Record<string, unknown>);
    } catch { /* skip non-JSON frames */ }
  }
  const steps = extractStepsFromEvents(events);
  saveInteraction(prompt, steps);
  if (CONFIG.learningModeRaw) {
    printRaw(frames, "WS frames");
  }
}

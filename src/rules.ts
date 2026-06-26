import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";
import { log } from "./logger.js";
import type { NormalizedRule, NormalizedStep, OutputTag, PromptRule, ToolCall } from "./types.js";

export function normalizeRules(source: PromptRule[]): NormalizedRule[] {
  const normalized: NormalizedRule[] = [];

  for (const rule of source) {
    const input = Array.isArray(rule.input)
      ? rule.input.map((x) => String(x).trim()).filter(Boolean)
      : [];

    if (input.length === 0) continue;

    const title =
      typeof rule.title === "string" && rule.title.trim()
        ? rule.title.trim()
        : undefined;

    const outcome =
      typeof rule.outcome === "string" && rule.outcome.trim()
        ? rule.outcome.trim()
        : undefined;

    const normalizeToolCalls = (raw: unknown): ToolCall[] =>
      Array.isArray(raw)
        ? (raw as ToolCall[]).filter(
            (tc) => tc && typeof tc.name === "string" && tc.name.trim(),
          )
        : [];

    const ruleDelayMs = typeof rule.delayMs === "number" && rule.delayMs > 0 ? rule.delayMs : 0;

    // Multi-step rules override output + toolCalls
    if (Array.isArray(rule.steps) && rule.steps.length > 0) {
      const steps: NormalizedStep[] = rule.steps
        .map((s) => ({
          text: typeof s?.text === "string" ? s.text : "",
          toolCalls: normalizeToolCalls(s?.toolCalls),
          delayMs: typeof s?.delayMs === "number" && s.delayMs > 0 ? s.delayMs : 0,
        }))
        .filter((s) => s.text || s.toolCalls.length > 0);

      if (steps.length > 0) {
        normalized.push({ input, title, outcome, text: "", tags: [], toolCalls: [], steps, delayMs: ruleDelayMs });
        continue;
      }
    }

    const toolCalls = normalizeToolCalls(rule.toolCalls);

    if (typeof rule.output === "string") {
      normalized.push({ input, title, outcome, text: rule.output, tags: [], toolCalls, steps: [], delayMs: ruleDelayMs });
      continue;
    }

    if (!rule.output || typeof rule.output !== "object") continue;

    const text = typeof rule.output.text === "string" ? rule.output.text : "";
    const tags: OutputTag[] = Array.isArray(rule.output.tags)
      ? rule.output.tags
          .filter(
            (t) =>
              t?.type === "file" && typeof t.path === "string" && t.path.trim(),
          )
          .map((t) => ({
            type: "file",
            path: t.path.trim(),
            label: typeof t.label === "string" ? t.label : undefined,
          }))
      : [];

    normalized.push({ input, title, outcome, text, tags, toolCalls, steps: [], delayMs: ruleDelayMs });
  }

  return normalized;
}

export function loadPromptRules(): NormalizedRule[] {
  if (CONFIG.responses) {
    if (!Array.isArray(CONFIG.responses)) {
      log("Config 'responses' field is not an array");
      return [];
    }
    return normalizeRules(CONFIG.responses);
  }

  const filePath = path.resolve(CONFIG.responsesPath);
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    log(`Failed to read responses file: ${(error as Error).message}`);
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as PromptRule[];
    if (!Array.isArray(parsed)) {
      log("Responses file is not an array");
      return [];
    }
    return normalizeRules(parsed);
  } catch (error) {
    log(`Invalid responses JSON: ${(error as Error).message}`);
    return [];
  }
}

export function findRule(
  prompt: string,
  rules: NormalizedRule[],
): NormalizedRule | null {
  const haystack = prompt.toLowerCase();
  const terms = new Set(
    haystack.match(/[a-z0-9_./:-]+/gi)?.map((t) => t.toLowerCase()) ?? [],
  );

  const matchesNeedle = (needle: string) => {
    const n = needle.toLowerCase().trim();
    if (!n) return false;

    if (n.includes(" ")) {
      return haystack.includes(n);
    }

    return terms.has(n);
  };

  const matches = rules.filter((rule) => rule.input.every(matchesNeedle));
  if (matches.length === 0) return null;

  // Prefer the most specific matching rule:
  // 1) more required tokens, 2) longer total token length, 3) original order.
  matches.sort((a, b) => {
    const tokenDiff = b.input.length - a.input.length;
    if (tokenDiff !== 0) return tokenDiff;

    const aLen = a.input.reduce((sum, s) => sum + s.length, 0);
    const bLen = b.input.reduce((sum, s) => sum + s.length, 0);
    return bLen - aLen;
  });

  return matches[0];
}

export function renderOutputText(text: string, tags: OutputTag[]): string {
  let rendered = text;

  rendered = rendered.replace(
    /\[\[file:([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_all, rawPath, rawLabel) => {
      const filePath = String(rawPath).trim();
      const label = String(rawLabel || rawPath).trim();
      return `[${label}](${filePath})`;
    },
  );

  if (tags.length > 0) {
    const links = tags
      .map((tag) => `[${tag.label || tag.path}](${tag.path})`)
      .join(", ");
    rendered = rendered.trim()
      ? `${rendered}\n\nArtifacts: ${links}`
      : `Artifacts: ${links}`;
  }

  return rendered;
}

import type { IncomingMessage } from "node:http";

export function parseRequestPrompt(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const value = obj as Record<string, unknown>;
  const userCandidates: string[] = [];
  const fallbackCandidates: string[] = [];

  const extractLastUserRequest = (text: string) => {
    const re = /<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/gi;
    let last: string | null = null;
    let match: RegExpExecArray | null = null;

    while ((match = re.exec(text)) !== null) {
      const candidate = String(match[1] || "").trim();
      if (candidate) {
        last = candidate;
      }
    }

    return last;
  };

  const normalizeCandidate = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return "";
    const nestedRequest = extractLastUserRequest(trimmed);
    return nestedRequest ?? trimmed;
  };

  const extractText = (container: Record<string, unknown>) => {
    const parts: string[] = [];

    if (typeof container.content === "string") {
      parts.push(container.content);
    }

    if (Array.isArray(container.content)) {
      for (const c of container.content) {
        if (!c || typeof c !== "object") continue;
        const part = c as Record<string, unknown>;
        if (typeof part.text === "string") parts.push(part.text);
        if (typeof part.content === "string") parts.push(part.content);
        if (typeof part.type === "string" && /text$/i.test(part.type)) {
          const maybeText = part.text ?? part.content;
          if (typeof maybeText === "string") parts.push(maybeText);
        }
      }
    }

    return normalizeCandidate(parts.join("\n").trim());
  };

  const collectText = (container: Record<string, unknown>, role?: string) => {
    const text = extractText(container);
    if (!text) return;
    const target = role === "user" ? userCandidates : fallbackCandidates;
    target.push(text);
  };

  if (typeof value.prompt === "string") fallbackCandidates.push(value.prompt);
  if (typeof value.input === "string") fallbackCandidates.push(value.input);

  if (Array.isArray(value.input)) {
    for (const item of value.input) {
      if (typeof item === "string") {
        fallbackCandidates.push(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;

      const inputObj = item as Record<string, unknown>;
      const role =
        typeof inputObj.role === "string" ? inputObj.role : undefined;
      collectText(inputObj, role);
    }
  }

  if (Array.isArray(value.messages)) {
    for (const msg of value.messages) {
      if (!msg || typeof msg !== "object") continue;
      const msgObj = msg as Record<string, unknown>;
      const role = typeof msgObj.role === "string" ? msgObj.role : undefined;
      collectText(msgObj, role);
    }
  }

  // Prefer only user-authored text to avoid accidental keyword matches
  // from long system/developer instructions in the payload.
  if (userCandidates.length > 0) {
    return userCandidates[userCandidates.length - 1].trim();
  }

  if (fallbackCandidates.length > 0) {
    return fallbackCandidates[fallbackCandidates.length - 1].trim();
  }

  return "";
}

export function describeRequest(raw: string): { prompt: string; summary: string } {
  try {
    const obj = JSON.parse(raw) as unknown;
    const prompt = parseRequestPrompt(obj);
    const summary = prompt
      ? `prompt="${prompt.slice(0, 120)}"`
      : "(no prompt found)";
    return { prompt, summary };
  } catch {
    return { prompt: "", summary: "(non-JSON body)" };
  }
}

export function parseIncomingTarget(
  rawUrl: string | undefined,
  headers: IncomingMessage["headers"],
) {
  const value = String(rawUrl || "/");
  const host = headers.host || "localhost";
  const urlObj = new URL(value, `http://${host}`);
  return `${urlObj.pathname}${urlObj.search}`;
}

export function parseIncomingPathname(
  rawUrl: string | undefined,
  headers: IncomingMessage["headers"],
) {
  const value = String(rawUrl || "/");
  const host = headers.host || "localhost";
  const urlObj = new URL(value, `http://${host}`);
  return urlObj.pathname;
}

export function isToolResultRequest(raw: string): boolean {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // Responses API: input array contains function_call_output items
    if (Array.isArray(obj.input)) {
      return (obj.input as unknown[]).some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "function_call_output",
      );
    }
    // Chat Completions: messages array contains a tool-role message
    if (Array.isArray(obj.messages)) {
      return (obj.messages as unknown[]).some(
        (msg) =>
          msg &&
          typeof msg === "object" &&
          (msg as Record<string, unknown>).role === "tool",
      );
    }
    return false;
  } catch {
    return false;
  }
}

export function isMockablePostPath(pathname: string) {
  return /\/(chat\/completions|v1\/chat\/completions|responses|v1\/responses|messages|v1\/messages)$/i.test(
    pathname,
  );
}

export function isInternalUtilityPrompt(prompt: string) {
  const text = prompt.toLowerCase();
  if (!text.trim()) return false;

  return (
    // Catches "please write a brief title/branch name/label/… for the following request"
    (text.includes("please write a brief") && text.includes("for the following request")) ||
    text.includes("please generate exactly 10 unique progress messages") ||
    text.includes("predict the next code edit based on user context")
  );
}

const UTILITY_PATTERNS = [
  "please write a brief",
  "please generate exactly 10 unique progress messages",
  "predict the next code edit based on user context",
  "generate a title for",
  "generate a short title",
  "write a title for",
  "suggest a title for",
  "summarize the following content",
];

export function isInternalUtilityBody(raw: string): boolean {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return false;
  }

  if (!obj || typeof obj !== "object") return false;
  const body = obj as Record<string, unknown>;

  const allText: string[] = [];

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      if (typeof m.content === "string") allText.push(m.content);
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part && typeof part === "object") {
            const p = part as Record<string, unknown>;
            if (typeof p.text === "string") allText.push(p.text);
          }
        }
      }
    }
  }

  const combined = allText.join("\n").toLowerCase();
  return combined.trim() !== "" && UTILITY_PATTERNS.some((p) => combined.includes(p));
}

export function isSummarizationUtilityBody(raw: string): boolean {
  return raw.toLowerCase().includes("summarize the following content");
}

export function parseRequestModel(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.model === "string" && obj.model ? obj.model : null;
  } catch {
    return null;
  }
}

export function sanitizeForwardHeaders(headers: IncomingMessage["headers"]) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "content-length" ||
      lower === "connection"
    )
      continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export type ChunkMode = "word" | "char";

export interface OutputTag {
  type: "file";
  path: string;
  label?: string;
}

export interface ToolCall {
  name: string;
  arguments: string;
}

export interface OutputStep {
  text?: string;
  toolCalls?: ToolCall[];
  delayMs?: number;
}

export interface NormalizedStep {
  text: string;
  toolCalls: ToolCall[];
  delayMs: number;
}

export interface PromptRule {
  input: string[];
  title?: string;
  outcome?: string;
  output?: string | { text: string; tags?: OutputTag[] };
  toolCalls?: ToolCall[];
  steps?: OutputStep[];
  delayMs?: number;
}

export interface NormalizedRule {
  input: string[];
  title?: string;
  outcome?: string;
  text: string;
  tags: OutputTag[];
  toolCalls: ToolCall[];
  steps: NormalizedStep[];
  delayMs: number;
}

export interface ResponseContent {
  type: "output_text";
  text: string;
  annotations: Array<Record<string, unknown>>;
}

export interface MessageItem {
  id: string;
  type: "message";
  status: "in_progress" | "completed";
  role: "assistant";
  content: ResponseContent[];
}

export interface Config {
  port: number;
  responsesPath: string;
  responses?: PromptRule[];
  defaultResponse: string;
  tokenDelayMs: number;
  chunkBy: ChunkMode;
  logFile: string;
  enableConsoleLogs: boolean;
  logRequestBodies: boolean;
  forwardUnmatched: boolean;
  fallbackBaseUrl: string;
  fallbackAltBaseUrl: string;
  learningMode: boolean;
  learnFile: string;
  learningModeRaw: boolean;
}

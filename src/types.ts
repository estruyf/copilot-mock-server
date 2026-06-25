export type ChunkMode = "word" | "char";

export interface OutputTag {
  type: "file";
  path: string;
  label?: string;
}

export interface PromptRule {
  input: string[];
  title?: string;
  output: string | { text: string; tags?: OutputTag[] };
}

export interface NormalizedRule {
  input: string[];
  title?: string;
  text: string;
  tags: OutputTag[];
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
}

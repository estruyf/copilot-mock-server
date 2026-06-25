import type { ServerResponse } from "node:http";
import WebSocket from "ws";
import { CONFIG } from "./config.js";
import { sleep, rid } from "./logger.js";
import type { ChunkMode, MessageItem } from "./types.js";

export function chunkText(text: string, mode: ChunkMode): string[] {
  if (mode === "char") return [...text];
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

export function messageItem(
  id: string,
  status: "in_progress" | "completed",
  text: string,
): MessageItem {
  return {
    id,
    type: "message",
    status,
    role: "assistant",
    content: text ? [{ type: "output_text", text, annotations: [] }] : [],
  };
}

export function responseSnapshot(
  id: string,
  status: "in_progress" | "completed",
  text: string,
) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: "gpt-mock-1",
    output:
      status === "completed" && text
        ? [messageItem(rid("msg"), "completed", text)]
        : [],
    usage:
      status === "completed"
        ? { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
        : null,
  };
}

export function buildFrames(fullText: string) {
  const responseId = rid("resp");
  const itemId = rid("msg");
  const frames: Array<{ event: Record<string, unknown>; delayMs: number }> = [];
  let seq = 0;

  const push = (event: Record<string, unknown>, delayMs = 0) => {
    event.sequence_number = seq++;
    frames.push({ event, delayMs });
  };

  push({
    type: "response.created",
    response: responseSnapshot(responseId, "in_progress", ""),
  });
  push({
    type: "response.in_progress",
    response: responseSnapshot(responseId, "in_progress", ""),
  });
  push({
    type: "response.output_item.added",
    output_index: 0,
    item: messageItem(itemId, "in_progress", ""),
  });
  push({
    type: "response.content_part.added",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });

  for (const tok of chunkText(fullText, CONFIG.chunkBy)) {
    push(
      {
        type: "response.output_text.delta",
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        delta: tok,
      },
      CONFIG.tokenDelayMs,
    );
  }

  push({
    type: "response.output_text.done",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text: fullText,
  });
  push({
    type: "response.content_part.done",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: fullText, annotations: [] },
  });
  push({
    type: "response.output_item.done",
    output_index: 0,
    item: messageItem(itemId, "completed", fullText),
  });
  push({
    type: "response.completed",
    response: responseSnapshot(responseId, "completed", fullText),
  });

  return frames;
}

export function buildChatCompletionsChunks(fullText: string) {
  const id = rid("chatcmpl");
  const created = Math.floor(Date.now() / 1000);
  const model = "gpt-mock-1";
  const chunks: Array<Record<string, unknown>> = [];

  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: null,
      },
    ],
  });

  for (const tok of chunkText(fullText, CONFIG.chunkBy)) {
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content: tok },
          finish_reason: null,
        },
      ],
    });
  }

  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  });

  return chunks;
}

export function serializeWsFrame(event: Record<string, unknown>) {
  return JSON.stringify(event);
}

export async function streamOverWebSocket(
  ws: WebSocket,
  frames: Array<{ event: Record<string, unknown>; delayMs: number }>,
) {
  for (const { event, delayMs } of frames) {
    if (delayMs) await sleep(delayMs);
    if (ws.readyState !== ws.OPEN) return;
    ws.send(serializeWsFrame(event));
  }
}

export async function streamOverSSE(
  res: ServerResponse,
  frames: Array<{ event: Record<string, unknown>; delayMs: number }>,
) {
  for (const { event, delayMs } of frames) {
    if (delayMs) await sleep(delayMs);
    if (res.writableEnded) return;
    const eventType = String(event.type || "message");
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

export async function streamOverChatCompletionsSSE(
  res: ServerResponse,
  chunks: Array<Record<string, unknown>>,
) {
  for (const chunk of chunks) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (CONFIG.tokenDelayMs > 0) {
      await sleep(CONFIG.tokenDelayMs);
    }
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

export function buildAnthropicMessagesEvents(fullText: string) {
  const id = rid("msg");
  const model = "claude-mock-1";
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];

  events.push({
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
  });

  events.push({
    event: "content_block_start",
    data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  });

  events.push({ event: "ping", data: { type: "ping" } });

  for (const tok of chunkText(fullText, CONFIG.chunkBy)) {
    events.push({
      event: "content_block_delta",
      data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tok } },
    });
  }

  events.push({ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } });

  events.push({
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 0 },
    },
  });

  events.push({ event: "message_stop", data: { type: "message_stop" } });

  return events;
}

export async function streamOverAnthropicMessagesSSE(
  res: ServerResponse,
  events: Array<{ event: string; data: Record<string, unknown> }>,
) {
  for (const { event, data } of events) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (CONFIG.tokenDelayMs > 0 && event === "content_block_delta") {
      await sleep(CONFIG.tokenDelayMs);
    }
  }
  res.end();
}

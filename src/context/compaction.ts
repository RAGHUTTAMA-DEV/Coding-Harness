import { ChatModelClient, Message } from "../client";

/**
 * Normalizes tool arguments object to a sorted JSON string
 * for reliable exact matching during duplication checks.
 */
export function normalizeArgs(args: any): string {
  if (args === null || typeof args !== "object") {
    return JSON.stringify(args);
  }
  const keys = Object.keys(args).sort();
  const sorted: any = {};
  for (const k of keys) {
    sorted[k] = args[k];
  }
  return JSON.stringify(sorted);
}

/**
 * Performs microcompaction on conversation messages.
 * If a tool call has been executed multiple times with identical arguments,
 * earlier tool result content is replaced with a tombstone to save context.
 */
export function microcompact(messages: Message[]): Message[] {
  // Build tool call args map
  const toolCallArgs = new Map<string, any>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCallArgs.set(tc.id, tc.function.arguments);
      }
    }
  }

  // Clone messages to avoid mutating parameter in-place directly
  const result = messages.map(m => ({ ...m }));

  for (let i = 0; i < result.length; i++) {
    const m1 = result[i];
    if (m1.role !== "tool") continue;

    // Skip if already tombstoned
    if (m1.content.startsWith("[Output of tool") && m1.content.endsWith("superseded by a later call. Content removed.]")) {
      continue;
    }

    const args1 = toolCallArgs.get(m1.tool_call_id || "");
    if (args1 === undefined) continue;

    const args1Str = normalizeArgs(args1);

    // Look forward for a duplicate tool call
    let superseded = false;
    for (let j = i + 1; j < result.length; j++) {
      const m2 = result[j];
      if (m2.role !== "tool" || m2.name !== m1.name) continue;

      const args2 = toolCallArgs.get(m2.tool_call_id || "");
      if (args2 === undefined) continue;

      const args2Str = normalizeArgs(args2);

      if (args1Str === args2Str) {
        superseded = true;
        break;
      }
    }

    if (superseded) {
      m1.content = `[Output of tool "${m1.name}" with arguments ${JSON.stringify(args1)} superseded by a later call. Content removed.]`;
    }
  }

  return result;
}

/**
 * Summarizes the first 50% of messages in the list and replaces them with a single summary message.
 * Returns the updated message list and the generated summary text.
 */
export async function summarizeHistory(
  messages: Message[],
  client: ChatModelClient
): Promise<{ messages: Message[]; summary: string }> {
  if (messages.length < 4) {
    return { messages, summary: "" };
  }

  // Summarize the first half of the conversation
  const halfIndex = Math.floor(messages.length / 2);
  const toSummarize = messages.slice(0, halfIndex);
  const remaining = messages.slice(halfIndex);

  // Format the conversation turns into a text transcript
  let chatLog = "";
  for (const msg of toSummarize) {
    if (msg.role === "user") {
      chatLog += `User: ${msg.content}\n\n`;
    } else if (msg.role === "assistant") {
      if (msg.thinking) {
        chatLog += `Assistant Thought: ${msg.thinking}\n`;
      }
      if (msg.content) {
        chatLog += `Assistant: ${msg.content}\n`;
      }
      if (msg.tool_calls) {
        chatLog += `Assistant called tools: ${msg.tool_calls.map(tc => tc.function.name).join(", ")}\n`;
      }
      chatLog += "\n";
    } else if (msg.role === "tool") {
      // Limit size of tool results in the prompt log
      const toolContent = msg.content.length > 500
        ? msg.content.substring(0, 500) + "..."
        : msg.content;
      chatLog += `Tool (${msg.name}) Result: ${toolContent}\n\n`;
    } else if (msg.role === "system") {
      chatLog += `System instruction/summary: ${msg.content}\n\n`;
    }
  }

  const summaryPrompt = `You are a technical assistant. Summarize the following part of the conversation history.
Focus on key decisions made, code files modified, tests run, command results, and the current state of the implementation.
Be highly concise, structured, and technical. Avoid any conversational greeting, preamble, or filler.

Conversation part to summarize:
---
${chatLog}
---
Provide the technical summary now:`;

  // Request Ollama client to generate summary (non-streaming, gather final output)
  const summaryMsg = await client.chatStream(
    [
      { role: "user", content: summaryPrompt }
    ],
    [], // No tools
    () => {} // No-op callback
  );

  const summaryText = summaryMsg.content.trim();

  // Create the replacement system message
  const summaryMessage: Message = {
    role: "system",
    content: `[Summary of earlier conversation history:\n${summaryText}]`
  };

  return {
    messages: [summaryMessage, ...remaining],
    summary: summaryText
  };
}

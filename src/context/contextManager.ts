import * as path from "path";
import { Message, OllamaClient } from "../client";
import { microcompact, summarizeHistory } from "./compaction";

export interface ContextManagerOptions {
  client: OllamaClient;
  systemPrompt: string;
  projectMemory?: string | null;
  tokenThreshold?: number;
}

export class ContextManager {
  private messages: Message[] = [];
  private systemPrompt: string;
  private projectMemory: string | null = null;
  private tokenThreshold: number;
  private client: OllamaClient;
  private totalTokens: number = 0;

  constructor(options: ContextManagerOptions) {
    this.client = options.client;
    this.systemPrompt = options.systemPrompt;
    this.projectMemory = options.projectMemory || null;
    this.tokenThreshold = options.tokenThreshold || 8000;
  }

  /**
   * Adds a user or assistant/tool message to the history.
   */
  addMessage(msg: Message) {
    this.messages.push(msg);
  }

  /**
   * Returns the dynamic conversation messages list.
   */
  getHistory(): Message[] {
    return this.messages;
  }

  /**
   * Sets history messages directly (useful for testing/compaction).
   */
  setHistory(msgs: Message[]) {
    this.messages = msgs;
  }

  /**
   * Clears the dynamic message history.
   */
  clearHistory() {
    this.messages = [];
    this.totalTokens = 0;
  }

  /**
   * Resolves the full payload to send to the Ollama API,
   * including cached system prompt and project memory elements.
   */
  getPayload(): Message[] {
    const payload: Message[] = [];

    payload.push({
      role: "system",
      content: this.systemPrompt,
      cache_control: { type: "ephemeral" }
    });

    if (this.projectMemory) {
      payload.push({
        role: "system",
        content: `Project Memory (AGENT.md):\n${this.projectMemory}`,
        cache_control: { type: "ephemeral" }
      });
    }

    payload.push(...this.messages);
    return payload;
  }

  /**
   * Scans history and invalidates any read_file results targeting the mutated path.
   * Replaces file contents with a clean tombstone to save space and prevent stale contexts.
   */
  invalidateStaleReads(mutatedPath: string): number {
    const resolvedMutation = path.resolve(mutatedPath);

    // Build map of tool call IDs to arguments to inspect read paths
    const toolCallInfo = new Map<string, { name: string; args: any }>();
    for (const msg of this.messages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCallInfo.set(tc.id, {
            name: tc.function.name,
            args: tc.function.arguments
          });
        }
      }
    }

    let invalidatedCount = 0;
    for (const msg of this.messages) {
      if (msg.role === "tool" && msg.name === "read_file") {
        const info = toolCallInfo.get(msg.tool_call_id || "");
        if (info && info.args && info.args.path) {
          const resolvedReadPath = path.resolve(info.args.path);
          if (resolvedReadPath === resolvedMutation) {
            // Update only if not already tombstoned
            if (!msg.content.startsWith("[File content of")) {
              msg.content = `[File content of ${info.args.path} has been modified by a subsequent edit/write tool call. This read result is now stale and has been invalidated to save context space.]`;
              invalidatedCount++;
            }
          }
        }
      }
    }
    return invalidatedCount;
  }

  /**
   * Tracks total token count from the latest turn.
   */
  updateTokens(assistantMsg: Message) {
    if (assistantMsg.usage) {
      this.totalTokens = assistantMsg.usage.total_tokens;
    }
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  getTokenThreshold(): number {
    return this.tokenThreshold;
  }

  /**
   * Triggers microcompaction and evaluates summarization compaction.
   * If total tokens exceeds threshold, older turns are folded into a system summary.
   * Returns the summary text if summarization occurred, otherwise null.
   */
  async compactIfNeeded(): Promise<string | null> {
    // 1. Always run microcompaction to clean up duplicate tool executions
    this.messages = microcompact(this.messages);

    // 2. If token limit exceeded, trigger summarization compaction
    if (this.totalTokens > this.tokenThreshold && this.messages.length >= 4) {
      const result = await summarizeHistory(this.messages, this.client);
      this.messages = result.messages;

      // Recalculate estimated tokens after compaction
      const payload = this.getPayload();
      this.totalTokens = Math.ceil(JSON.stringify(payload).length / 4);

      return result.summary;
    }

    return null;
  }
}

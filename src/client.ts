export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: any;
  };
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  thinking?: string;
  name?: string; // used for role: tool
  tool_call_id?: string; // used for role: tool (OpenAI compatibility)
  tool_calls?: ToolCall[];
  cache_control?: { type: "ephemeral" };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: any;
  cache_control?: { type: "ephemeral" };
}

export class OllamaClient {
  private url: string;
  private model: string;

  constructor(url: string = "http://127.0.0.1:11434/api/chat", model: string = "qwen3:8b") {
    this.url = url;
    this.model = model;
  }

  /**
   * Helper to format tool definitions to Ollama function-calling schema
   */
  private formatTools(tools: ToolDefinition[]) {
    if (tools.length === 0) return undefined;
    return tools.map(t => {
      const formatted: any = {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }
      };
      if (t.cache_control) {
        formatted.cache_control = t.cache_control;
      }
      return formatted;
    });
  }

  /**
   * Streams a chat completion from Ollama.
   * Calls onChunk with chunks as they arrive.
   * Returns the final combined Message.
   */
  async chatStream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: { content: string; thinking: string; toolCalls: ToolCall[] }) => void
  ): Promise<Message> {
    const requestBody = {
      model: this.model,
      messages: messages.map(msg => {
        // Clean up messages to Ollama format
        const formatted: any = {
          role: msg.role,
          content: msg.content
        };
        if (msg.thinking) formatted.thinking = msg.thinking;
        if (msg.name) formatted.name = msg.name;
        if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
        if (msg.cache_control) formatted.cache_control = msg.cache_control;
        return formatted;
      }),
      tools: this.formatTools(tools),
      stream: true
    };

    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Ollama response body is not readable.");
    }

    const decoder = new TextDecoder();
    let accumulatedContent = "";
    let accumulatedThinking = "";
    let accumulatedToolCalls: ToolCall[] = [];
    let promptEvalCount = 0;
    let evalCount = 0;

    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last partial line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() === "") continue;

        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          // If we fail to parse, it might be a split JSON chunk or corrupt data
          continue;
        }

        if (parsed.prompt_eval_count) {
          promptEvalCount = parsed.prompt_eval_count;
        }
        if (parsed.eval_count) {
          evalCount = parsed.eval_count;
        }

        const msg = parsed.message;
        if (!msg) continue;

        const content = msg.content || "";
        const thinking = msg.thinking || "";
        const toolCallsRaw = msg.tool_calls || [];

        accumulatedContent += content;
        accumulatedThinking += thinking;

        const toolCalls: ToolCall[] = [];
        for (const tc of toolCallsRaw) {
          // Ollama might structure tool calls slightly differently depending on model/version.
          // Let's normalize it to ToolCall interface.
          const name = tc.function?.name || tc.name;
          let args = tc.function?.arguments || tc.arguments;

          // If arguments is a string (some models return stringified JSON), parse it
          if (typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch (e) {
              // Ignore
            }
          }

          const id = tc.id || tc.function?.id || `call_${Math.random().toString(36).substring(2, 10)}`;
          
          const normalizedCall: ToolCall = {
            id,
            function: { name, arguments: args }
          };
          toolCalls.push(normalizedCall);
          
          // Merge to accumulated tool calls
          // We can check if we already have a tool call with this index or id
          const existingIdx = accumulatedToolCalls.findIndex(existing => existing.id === id);
          if (existingIdx >= 0) {
            accumulatedToolCalls[existingIdx] = normalizedCall;
          } else {
            accumulatedToolCalls.push(normalizedCall);
          }
        }

        if (content || thinking || toolCalls.length > 0) {
          onChunk({
            content,
            thinking,
            toolCalls
          });
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.prompt_eval_count) {
          promptEvalCount = parsed.prompt_eval_count;
        }
        if (parsed.eval_count) {
          evalCount = parsed.eval_count;
        }
        const msg = parsed.message;
        if (msg) {
          const content = msg.content || "";
          const thinking = msg.thinking || "";
          accumulatedContent += content;
          accumulatedThinking += thinking;
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              const name = tc.function?.name || tc.name;
              let args = tc.function?.arguments || tc.arguments;
              if (typeof args === "string") {
                try { args = JSON.parse(args); } catch (e) {}
              }
              const id = tc.id || tc.function?.id || `call_${Math.random().toString(36).substring(2, 10)}`;
              accumulatedToolCalls.push({ id, function: { name, arguments: args } });
            }
          }
        }
      } catch (e) {}
    }

    const finalMsg: Message = {
      role: 'assistant',
      content: accumulatedContent,
      thinking: accumulatedThinking
    };

    if (accumulatedToolCalls.length > 0) {
      finalMsg.tool_calls = accumulatedToolCalls;
    }

    const promptFallback = Math.ceil(JSON.stringify(messages).length / 4);
    const completionFallback = Math.ceil((accumulatedContent.length + accumulatedThinking.length) / 4);

    finalMsg.usage = {
      prompt_tokens: promptEvalCount || promptFallback,
      completion_tokens: evalCount || completionFallback,
      total_tokens: (promptEvalCount || promptFallback) + (evalCount || completionFallback)
    };

    return finalMsg;
  }
}

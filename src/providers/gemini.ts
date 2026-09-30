import { ChatModelClient, Message, ToolCall, ToolDefinition } from "./types";

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: any };
  functionResponse?: { name: string; response: any };
  thought_signature?: string;
  thought?: boolean;
};

export class GeminiClient implements ChatModelClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options.model || "gemini-3.1-flash-lite";
    this.baseUrl = options.baseUrl || "https://generativelanguage.googleapis.com/v1beta/models";
  }

  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== "object") {
      return { type: "object", properties: {} };
    }

    let raw = { ...schema };

    // Resolve anyOf / oneOf if present (common in JSON schemas for optional/nullable types)
    if (Array.isArray(raw.anyOf) && raw.anyOf.length > 0) {
      const isNullable = raw.anyOf.some((s: any) => s && (s.type === "null" || s.nullable === true));
      const nonNullBranch = raw.anyOf.find((s: any) => s && s.type !== "null") || raw.anyOf[0];
      raw = { ...raw, ...(typeof nonNullBranch === "object" ? nonNullBranch : {}) };
      if (isNullable) {
        raw.nullable = true;
      }
      delete raw.anyOf;
    } else if (Array.isArray(raw.oneOf) && raw.oneOf.length > 0) {
      const isNullable = raw.oneOf.some((s: any) => s && (s.type === "null" || s.nullable === true));
      const nonNullBranch = raw.oneOf.find((s: any) => s && s.type !== "null") || raw.oneOf[0];
      raw = { ...raw, ...(typeof nonNullBranch === "object" ? nonNullBranch : {}) };
      if (isNullable) {
        raw.nullable = true;
      }
      delete raw.oneOf;
    }

    // Handle type array e.g. ["string", "null"]
    let schemaType = raw.type;
    let isNullable = raw.nullable === true;
    if (Array.isArray(schemaType)) {
      if (schemaType.includes("null")) {
        isNullable = true;
      }
      schemaType = schemaType.find((t: any) => t !== "null") || "string";
    }

    if (!schemaType && raw.properties) {
      schemaType = "object";
    }

    const sanitized: any = {};

    if (schemaType) {
      sanitized.type = typeof schemaType === "string" ? schemaType.toLowerCase() : "string";
    } else {
      sanitized.type = "object";
    }

    if (raw.description && typeof raw.description === "string") {
      sanitized.description = raw.description;
    }

    if (raw.format && typeof raw.format === "string") {
      sanitized.format = raw.format;
    }

    if (isNullable) {
      sanitized.nullable = true;
    }

    if (Array.isArray(raw.enum)) {
      sanitized.enum = raw.enum.map((e: any) => String(e));
    }

    if (raw.properties && typeof raw.properties === "object") {
      sanitized.properties = {};
      for (const [key, propVal] of Object.entries(raw.properties)) {
        sanitized.properties[key] = this.sanitizeSchema(propVal);
      }
    }

    if (Array.isArray(raw.required)) {
      sanitized.required = raw.required.filter((r: any) => typeof r === "string");
    }

    if (sanitized.type === "array") {
      if (raw.items && typeof raw.items === "object") {
        sanitized.items = this.sanitizeSchema(raw.items);
      } else {
        sanitized.items = { type: "string" };
      }
    }

    return sanitized;
  }

  private formatTools(tools: ToolDefinition[]) {
    if (tools.length === 0) return undefined;

    return [
      {
        functionDeclarations: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: this.sanitizeSchema(tool.input_schema)
        }))
      }
    ];
  }

  private formatMessages(messages: Message[]) {
    const systemMessages = messages.filter(message => message.role === "system");
    const nonSystemMessages = messages.filter(message => message.role !== "system");

    const systemInstruction = systemMessages.length > 0
      ? {
          parts: [{ text: systemMessages.map(message => message.content).join("\n\n") }]
        }
      : undefined;

    const contents = nonSystemMessages.map(message => {
      if (message.role === "tool") {
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: message.name || "tool",
                response: { content: message.content }
              }
            }
          ]
        };
      }

      if (message.role === "assistant" && message.raw_parts && message.raw_parts.length > 0) {
        return {
          role: "model",
          parts: message.raw_parts
        };
      }

      const parts: GeminiPart[] = [];
      if (message.content) {
        parts.push({ text: message.content });
      }

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          const part: GeminiPart = {
            functionCall: {
              name: toolCall.function.name,
              args: toolCall.function.arguments
            }
          };

          if (toolCall.thought_signature) {
            part.thought_signature = toolCall.thought_signature;
          } else if (message.thought_signature) {
            part.thought_signature = message.thought_signature;
          }

          parts.push(part);
        }
      }

      if (message.thought_signature && !message.tool_calls) {
        parts.push({ thought_signature: message.thought_signature });
      }

      return {
        role: message.role === "assistant" ? "model" : "user",
        parts
      };
    });

    return { systemInstruction, contents };
  }

  async chatStream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: { content: string; thinking: string; toolCalls: ToolCall[] }) => void
  ): Promise<Message> {
    if (!this.apiKey) {
      throw new Error("Gemini API key is missing. Set GEMINI_API_KEY or pass apiKey to GeminiClient.");
    }

    const { systemInstruction, contents } = this.formatMessages(messages);
    const requestBody: any = {
      contents,
      tools: this.formatTools(tools)
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    const response = await fetch(`${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    const candidate = data.candidates?.[0];
    const parts: GeminiPart[] = candidate?.content?.parts || [];

    let content = "";
    let thoughtSignature = "";
    const toolCalls: ToolCall[] = [];
    const rawParts = parts.map(part => ({ ...part }));

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      }

      if (part.thought_signature) {
        thoughtSignature = part.thought_signature;
      }

      if (part.functionCall) {
        const call = part.functionCall;
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 10)}`,
          thought_signature: part.thought_signature,
          function: {
            name: call.name,
            arguments: call.args ?? {}
          }
        });
      }
    }

    onChunk({
      content,
      thinking: "",
      toolCalls
    });

    const finalMsg: Message = {
      role: "assistant",
      content,
      thinking: ""
    };

    if (rawParts.length > 0) {
      finalMsg.raw_parts = rawParts;
    }

    if (thoughtSignature) {
      finalMsg.thought_signature = thoughtSignature;
    }

    if (toolCalls.length > 0) {
      finalMsg.tool_calls = toolCalls;
    }

    const usage = data.usageMetadata;
    if (usage) {
      finalMsg.usage = {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || ((usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0))
      };
    }

    return finalMsg;
  }
}
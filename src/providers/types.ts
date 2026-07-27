export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: any;
  };
  thought_signature?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  thinking?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  thought_signature?: string;
  raw_parts?: Array<Record<string, any>>;
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
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  cache_control?: { type: "ephemeral" };
}

export interface ChatModelClient {
  chatStream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: { content: string; thinking: string; toolCalls: ToolCall[] }) => void
  ): Promise<Message>;
}
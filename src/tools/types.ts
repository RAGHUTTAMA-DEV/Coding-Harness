export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  isMutating: boolean;
  run(args: any): Promise<string> | string;
}

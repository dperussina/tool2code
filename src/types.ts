/** A tool as an MCP server or provider SDK hands it over. */
export type Tool = {
  name: string;
  description?: string;
  input_schema?: JsonSchema;
  inputSchema?: JsonSchema;
};

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  [k: string]: unknown;
};

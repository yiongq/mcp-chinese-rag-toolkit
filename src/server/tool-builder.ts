import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { McpToolDefinition } from './create-mcp-server.js';

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;
const PARAM_KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

const MAX_TOOL_DESCRIPTION_CHARS = 2048;

export interface ToolExample {
  description: string;
  input: Record<string, unknown>;
}

export interface ToolDefinitionInput<I extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  description: string;
  whenToUse: string;
  examples?: ToolExample[];
  inputSchema: I;
  handler: (args: z.infer<I>) => Promise<CallToolResult> | CallToolResult;
}

function validateToolName(name: string): void {
  if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) {
    throw new Error(
      `Tool name must be snake_case (matching ${TOOL_NAME_RE.source}). Got: '${name}'`,
    );
  }
}

function validateInputSchemaKeys(schema: z.ZodTypeAny): void {
  // Optional fallback: non-ZodObject schemas have no `.shape` to introspect.
  // The SDK still validates payloads at runtime, so we warn instead of throwing.
  // Array shapes also fall through here — Object.keys() on an array yields numeric
  // indices that would produce confusing "must be camelCase" errors, so reject early.
  const maybeShape = (schema as { shape?: unknown }).shape;
  if (
    maybeShape === undefined ||
    maybeShape === null ||
    typeof maybeShape !== 'object' ||
    Array.isArray(maybeShape)
  ) {
    console.warn(
      '[defineTool] top-level inputSchema should be z.object() for parameter name validation',
    );
    return;
  }

  for (const key of Object.keys(maybeShape as Record<string, unknown>)) {
    if (!PARAM_KEY_RE.test(key)) {
      throw new Error(
        `Tool inputSchema parameter '${key}' must be camelCase (matching ${PARAM_KEY_RE.source})`,
      );
    }
  }
}

function safeStringifyInput(input: Record<string, unknown>, index: number): string {
  // Tool authors may inadvertently put BigInt or circular structures into example.input;
  // surface a friendly build-time error pointing to the offending example instead of a raw
  // `TypeError: Do not know how to serialize a BigInt` from inside JSON.stringify.
  try {
    return JSON.stringify(input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `defineTool: examples[${index}].input is not JSON-serializable (${reason}). Avoid BigInt / circular references.`,
    );
  }
}

function composeDescription(def: {
  description: string;
  whenToUse: string;
  examples?: ToolExample[];
}): string {
  if (typeof def.description !== 'string' || def.description.trim().length === 0) {
    throw new Error("defineTool: 'description' is required and must be a non-empty string");
  }
  if (typeof def.whenToUse !== 'string' || def.whenToUse.trim().length === 0) {
    throw new Error("defineTool: 'whenToUse' is required and must be a non-empty string");
  }

  const lines: string[] = [def.description.trim(), '', `**When to use**: ${def.whenToUse.trim()}`];

  if (def.examples && def.examples.length > 0) {
    lines.push('', '**Examples**:');
    def.examples.forEach((ex, i) => {
      lines.push(`${i + 1}. ${ex.description}`, `   Input: ${safeStringifyInput(ex.input, i)}`);
    });
  }

  const composed = lines.join('\n');
  if (composed.length > MAX_TOOL_DESCRIPTION_CHARS) {
    throw new Error(
      `defineTool: composed description exceeds MAX_TOOL_DESCRIPTION_CHARS (${MAX_TOOL_DESCRIPTION_CHARS}). Got ${composed.length} chars; please trim description / whenToUse / examples.`,
    );
  }
  return composed;
}

export function defineTool<I extends z.ZodObject<z.ZodRawShape>>(
  def: ToolDefinitionInput<I>,
): McpToolDefinition {
  validateToolName(def.name);
  validateInputSchemaKeys(def.inputSchema);
  const description = composeDescription(def);
  return {
    name: def.name,
    description,
    inputSchema: def.inputSchema,
    handler: def.handler as (args: unknown) => Promise<CallToolResult> | CallToolResult,
  };
}

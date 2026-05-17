import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const ErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

export const ConfidenceLevelSchema = z.enum(['low', 'medium', 'high']);

export const CitationSchema = z.object({
  source: z.string(),
  // nonnegative (not positive) — supports 0-indexed page conventions used by some PDF parsers.
  page: z.number().int().nonnegative().optional(),
  section: z.string().optional(),
  content: z.string().optional(),
});

export const StructuredErrorPayloadSchema = z.object({
  error: ErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  suggestions: z.array(z.string()).optional(),
  confidence: ConfidenceLevelSchema.optional(),
  citations: z.array(CitationSchema).optional(),
  refusal: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type StructuredErrorPayload = z.infer<typeof StructuredErrorPayloadSchema>;

export interface CreateErrorOptions {
  retryable?: boolean;
  suggestions?: string[];
  confidence?: ConfidenceLevel;
  citations?: Citation[];
  refusal?: string;
  details?: Record<string, unknown>;
}

export const ERROR_CODES = {
  TIMEOUT: 'TIMEOUT',
  INVALID_INPUT: 'INVALID_INPUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ABORTED: 'ABORTED',
} as const;

export type ToolkitErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function create(
  code: string,
  message: string,
  opts: CreateErrorOptions = {},
): CallToolResult {
  ErrorCodeSchema.parse(code);

  const payload: StructuredErrorPayload = StructuredErrorPayloadSchema.parse({
    error: code,
    message,
    retryable: opts.retryable ?? false,
    ...(opts.suggestions !== undefined && { suggestions: opts.suggestions }),
    ...(opts.confidence !== undefined && { confidence: opts.confidence }),
    ...(opts.citations !== undefined && { citations: opts.citations }),
    ...(opts.refusal !== undefined && { refusal: opts.refusal }),
    ...(opts.details !== undefined && { details: opts.details }),
  });

  // JSON.stringify can throw on circular references in opts.details. Catching it here
  // upholds Rule #5: never let an exception escape an error envelope helper.
  let text: string;
  let safePayload: StructuredErrorPayload = payload;
  try {
    text = JSON.stringify(payload);
  } catch {
    safePayload = {
      ...payload,
      details: {
        _serializationError: 'details contained non-serializable values (e.g. circular reference)',
      },
    };
    text = JSON.stringify(safePayload);
  }

  return {
    content: [{ type: 'text', text }],
    isError: true,
    structuredContent: safePayload as unknown as Record<string, unknown>,
  };
}

export function isErrorEnvelope(result: unknown): result is CallToolResult & {
  isError: true;
  structuredContent: StructuredErrorPayload;
} {
  if (typeof result !== 'object' || result === null) return false;
  const candidate = result as { isError?: unknown; structuredContent?: unknown; content?: unknown };
  if (candidate.isError !== true) return false;
  if (!Array.isArray(candidate.content)) return false;
  const parsed = StructuredErrorPayloadSchema.safeParse(candidate.structuredContent);
  return parsed.success;
}

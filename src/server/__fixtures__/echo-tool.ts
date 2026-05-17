import { z } from 'zod';
import type { McpToolDefinition } from '../create-mcp-server.js';

const inputSchema = z.object({
  message: z.string().describe('The text to echo back verbatim.'),
});

export const echoTool: McpToolDefinition = {
  name: 'echo_tool',
  description:
    'Echo a string back to the caller. whenToUse: For toolkit smoke testing only — verifies transport + factory wiring end-to-end.',
  inputSchema,
  handler: async (args: unknown) => {
    // SDK validates args against `inputSchema` before invoking the handler,
    // so we trust the type and avoid a redundant parse. A re-parse here would
    // surface SDK validation regressions as INTERNAL_ERROR envelopes rather
    // than the proper invalid-input error path.
    const { message } = args as z.infer<typeof inputSchema>;
    return { content: [{ type: 'text', text: message }] };
  },
};

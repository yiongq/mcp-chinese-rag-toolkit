/**
 * Reference Anthropic Claude vision provider — COPY THIS FILE INTO YOUR
 * OWN PROJECT and wire in `process.env.ANTHROPIC_API_KEY`. The toolkit
 * intentionally ships zero vendor SDK dependencies (see Story 2.6
 * `LlmProvider` for the same pattern); install Anthropic separately:
 *
 *   pnpm add @anthropic-ai/sdk
 *
 * Other providers (豆包视觉 / 千问 VL / GPT-4o-mini) follow the same
 * shape — adapter author copies this file, swaps SDK + endpoint, and
 * keeps the {@link VisionProvider} contract: a `caption({ imagePng,
 * prompt, timeoutMs })` method that returns a Chinese caption string.
 *
 * This file lives under `templates/` and is NOT compiled into the
 * published `dist/`. The toolkit `tsconfig.json#include` excludes
 * `templates/**` so type-check stays clean even when `@anthropic-ai/sdk`
 * is not installed in the toolkit workspace.
 */
// @ts-expect-error optional SDK — install with `pnpm add @anthropic-ai/sdk` after copying this file.
import Anthropic from '@anthropic-ai/sdk';
import type { VisionProvider } from '@yiong/mcp-chinese-rag-toolkit';

export interface CreateAnthropicVisionProviderArgs {
  apiKey: string;
  /** @default 'claude-haiku-4-5' (cost-optimised vision-capable model). */
  model?: string;
}

export function createAnthropicVisionProvider(
  args: CreateAnthropicVisionProviderArgs,
): VisionProvider {
  if (typeof args.apiKey !== 'string' || args.apiKey === '') {
    throw new Error('createAnthropicVisionProvider: apiKey must be a non-empty string');
  }
  const client = new Anthropic({ apiKey: args.apiKey });
  const modelId = args.model ?? 'claude-haiku-4-5';
  return {
    providerId: 'anthropic',
    modelId,
    async caption({ imagePng, prompt, timeoutMs }) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const response = await client.messages.create(
          {
            model: modelId,
            max_tokens: 500,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: Buffer.from(imagePng).toString('base64'),
                    },
                  },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          },
          { signal: abort.signal },
        );
        const block = response.content.find((b: { type: string }) => b.type === 'text') as
          | { type: 'text'; text: string }
          | undefined;
        if (!block) {
          throw new Error('createAnthropicVisionProvider: Anthropic returned no text block');
        }
        return block.text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

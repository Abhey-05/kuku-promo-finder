import type { LlmOptions } from '../schema';
import { LlmError, postJson, type CallResult, type Message } from './http';

/** Claude, through the Messages API. The extra header allows calls straight from a browser. */
export async function anthropicCall(messages: Message[], opts: LlmOptions): Promise<CallResult> {
  if (!opts.apiKey) throw new LlmError('config', 'Anthropic needs an API key.');
  const data = (await postJson(
    `${(opts.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`,
    {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    { model: opts.model, max_tokens: 4096, temperature: opts.temperature ?? 0, messages },
    opts,
  )) as { model?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  return {
    text: (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
    model: data.model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  };
}

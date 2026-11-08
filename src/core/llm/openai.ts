import type { LlmOptions } from '../schema';
import { LlmError, type CallResult, type Message } from './http';
import { chatCompletions } from './openai-compatible';

/** OpenAI Chat Completions, with JSON mode on. */
export async function openAiCall(messages: Message[], opts: LlmOptions): Promise<CallResult> {
  if (!opts.apiKey) throw new LlmError('config', 'OpenAI needs an API key.');
  return chatCompletions(opts.baseUrl || 'https://api.openai.com/v1', messages, opts, { response_format: { type: 'json_object' } });
}

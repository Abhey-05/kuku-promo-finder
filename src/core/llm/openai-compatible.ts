import type { LlmOptions } from '../schema';
import { LlmError, postJson, type CallResult, type Message } from './http';

type ChatReply = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** Any /chat/completions endpoint. Shared by the OpenAI adapter. */
export async function chatCompletions(baseUrl: string, messages: Message[], opts: LlmOptions, extra: Record<string, unknown> = {}): Promise<CallResult> {
  const data = (await postJson(
    `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
    opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {},
    { model: opts.model, temperature: opts.temperature ?? 0, messages, ...extra },
    opts,
  )) as ChatReply;
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    model: data.model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

/** Covers Groq, OpenRouter, Together, local Ollama and any endpoint Kuku provides. */
export async function openAiCompatibleCall(messages: Message[], opts: LlmOptions): Promise<CallResult> {
  if (!opts.baseUrl) throw new LlmError('config', 'Enter a base URL, for example https://api.groq.com/openai/v1.');
  return chatCompletions(opts.baseUrl, messages, opts);
}

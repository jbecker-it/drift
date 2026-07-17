// ─── OpenRouter API Client ───────────────────────────

const BASE = 'https://openrouter.ai/api/v1';
const DRIFT_REFERER = 'https://github.com/jbecker-it/drift';
const DRIFT_TITLE = 'Drift Journal';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
}

export interface RequestOptions {
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

// ─── Shared builders ────────────────────────────────

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': DRIFT_REFERER,
    'X-Title': DRIFT_TITLE,
  };
}

function buildBody(
  messages: ChatMessage[],
  config: OpenRouterConfig,
  options: RequestOptions = {},
  stream = true,
) {
  return {
    model: config.model,
    messages,
    stream,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1024,
    ...(options.response_format ? { response_format: options.response_format } : {}),
    provider: { data_collection: 'deny' },
    plugins: [],
  };
}

// ─── Streaming chat completion ──────────────────────

/**
 * Stream a chat completion from OpenRouter.
 * Yields content chunks as they arrive.
 */
export async function* streamChat(
  messages: ChatMessage[],
  config: OpenRouterConfig,
  signal?: AbortSignal,
  options: RequestOptions = {},
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config.apiKey),
    body: JSON.stringify(buildBody(messages, config, options, true)),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No readable stream');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          yield cleanReasoningOutput(delta);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}

// ─── Non-streaming chat completion ──────────────────

/**
 * Non-streaming chat completion. Used for background jobs (tagging, summaries).
 */
export async function chatComplete(
  messages: ChatMessage[],
  config: OpenRouterConfig,
  signal?: AbortSignal,
  options: RequestOptions = {},
): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config.apiKey),
    body: JSON.stringify(buildBody(messages, config, options, false)),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

// ─── Reasoning block filter ─────────────────────────

/**
 * Strip leaked reasoning / thinking blocks from model output.
 * Some models inject <thinking>...</thinking> or similar into content.
 */
export function cleanReasoningOutput(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<思考>[\s\S]*?<\/思考>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

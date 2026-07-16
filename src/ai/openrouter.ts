// ─── OpenRouter API Client ───────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
}

const BASE = 'https://openrouter.ai/api/v1';

/**
 * Stream a chat completion from OpenRouter.
 * Yields content chunks as they arrive.
 */
export async function* streamChat(
  messages: ChatMessage[],
  config: OpenRouterConfig,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'Drift Journal',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
    }),
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
        if (delta) yield delta;
      } catch {
        // skip malformed lines
      }
    }
  }
}

/**
 * Non-streaming chat completion.
 */
export async function chatComplete(
  messages: ChatMessage[],
  config: OpenRouterConfig,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'Drift Journal',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

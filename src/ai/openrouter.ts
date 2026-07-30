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
  const reasoningFilter = createStreamingReasoningFilter();
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
          // Use stateful filter to handle reasoning tags across chunks
          reasoningFilter.push(delta);
          const cleaned = reasoningFilter.flush();
          if (cleaned) yield cleaned;
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

// ─── Reasoning block filter (streaming-aware) ────────

// Tag patterns to strip from model output
const TAG_PATTERNS = [
  { open: '<thinking>', close: '</thinking>' },
  { open: '<思考>', close: '</思考>' },
  { open: '<think>', close: '</think>' },
];

/**
 * Create a stateful streaming reasoning filter.
 * Call `.push(chunk)` for each SSE delta, then `.flush()` when the stream ends.
 * Returns cleaned text that can be displayed incrementally.
 */
export function createStreamingReasoningFilter() {
  let buffer = '';
  let inTag = false;
  let currentCloseTag = '';
  let cleaned = '';

  return {
    push(chunk: string): string {
      buffer += chunk;

      if (inTag) {
        // We're inside a reasoning tag — look for the closing tag
        const closeIdx = buffer.indexOf(currentCloseTag);
        if (closeIdx !== -1) {
          // Found closing tag — skip everything up to and including it
          buffer = buffer.substring(closeIdx + currentCloseTag.length);
          inTag = false;
          // Continue processing remaining buffer
        } else {
          // Still inside tag — don't output anything
          return '';
        }
      }

      // Process buffer for opening tags
      while (buffer.length > 0) {
        let earliestIdx = -1;
        let matchedOpen = '';
        let matchedClose = '';

        for (const pat of TAG_PATTERNS) {
          const idx = buffer.indexOf(pat.open);
          if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
            earliestIdx = idx;
            matchedOpen = pat.open;
            matchedClose = pat.close;
          }
        }

        if (earliestIdx === -1) {
          // No opening tag found — output everything up to the last safe position
          // Keep a small tail in case a tag starts at the end
          const safeLen = Math.max(0, buffer.length - 20);
          if (safeLen > 0) {
            cleaned += buffer.substring(0, safeLen);
            buffer = buffer.substring(safeLen);
          }
          break;
        }

        // Output text before the tag
        if (earliestIdx > 0) {
          cleaned += buffer.substring(0, earliestIdx);
          buffer = buffer.substring(earliestIdx);
        }

        // Check if closing tag is in the buffer
        const closeIdx = buffer.indexOf(matchedClose);
        if (closeIdx !== -1) {
          // Both tags in buffer — remove the whole block
          buffer = buffer.substring(closeIdx + matchedClose.length);
        } else {
          // Opening tag found but no closing yet — enter tag mode
          inTag = true;
          currentCloseTag = matchedClose;
          buffer = buffer.substring(matchedOpen.length);
          break;
        }
      }

      return cleaned;
    },

    flush(): string {
      return cleaned;
    },
  };
}

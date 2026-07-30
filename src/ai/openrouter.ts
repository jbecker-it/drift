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
      if (data === '[DONE]') {
        // Flush any remaining buffered text
        const tail = reasoningFilter.finish();
        if (tail) yield tail;
        return;
      }
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          const cleaned = reasoningFilter.push(delta);
          if (cleaned) yield cleaned;
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  // Stream ended without [DONE] — flush remaining
  const tail = reasoningFilter.finish();
  if (tail) yield tail;
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
  let outputIdx = 0; // Track how much we've already output
  let textParts: string[] = []; // Accumulate cleaned text parts
  let finished = false;

  function processBuffer(): void {
    if (inTag) {
      const closeIdx = buffer.indexOf(currentCloseTag);
      if (closeIdx !== -1) {
        buffer = buffer.substring(closeIdx + currentCloseTag.length);
        inTag = false;
      } else {
        return; // Still inside tag
      }
    }

    while (buffer.length > 0 && !inTag) {
      let earliestIdx = -1;
      let matchedClose = '';

      for (const pat of TAG_PATTERNS) {
        const idx = buffer.indexOf(pat.open);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
          matchedClose = pat.close;
        }
      }

      if (earliestIdx === -1) {
        // No tag found — keep a small tail in case a tag starts at the boundary
        const safeLen = Math.max(0, buffer.length - 20);
        if (safeLen > 0) {
          textParts.push(buffer.substring(0, safeLen));
          buffer = buffer.substring(safeLen);
        }
        break;
      }

      // Output text before the tag
      if (earliestIdx > 0) {
        textParts.push(buffer.substring(0, earliestIdx));
        buffer = buffer.substring(earliestIdx);
      }

      // Check if closing tag is in the buffer
      const closeIdx = buffer.indexOf(matchedClose);
      if (closeIdx !== -1) {
        buffer = buffer.substring(closeIdx + matchedClose.length);
      } else {
        inTag = true;
        currentCloseTag = matchedClose;
        // Skip past the opening tag
        for (const pat of TAG_PATTERNS) {
          if (pat.close === matchedClose) {
            buffer = buffer.substring(pat.open.length);
            break;
          }
        }
        break;
      }
    }
  }

  return {
    push(chunk: string): string {
      if (finished) return '';
      buffer += chunk;
      processBuffer();
      // Return only NEW text since last call
      const newText = textParts.join('');
      const newOutput = newText.substring(outputIdx);
      outputIdx = newText.length;
      return newOutput;
    },

    finish(): string {
      finished = true;
      // Release any remaining buffer (no more tags expected)
      if (buffer.length > 0) {
        textParts.push(buffer);
        buffer = '';
      }
      const newText = textParts.join('');
      const newOutput = newText.substring(outputIdx);
      outputIdx = newText.length;
      return newOutput;
    },

    flush(): string {
      // For backward compat — returns cumulative (for non-streaming use)
      processBuffer();
      return textParts.join('');
    },
  };
}

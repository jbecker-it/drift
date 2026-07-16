import { useState, useEffect, useRef } from 'react';
import { createSession, addMessageToSession, endSession, getRecentEntries } from '../db';
import { streamChat } from '../ai/openrouter';
import { buildMessages } from '../ai/prompts';
import { getModel, getApiKey } from '../db';

type Message = { role: 'user' | 'assistant'; content: string };

const QUICK_STARTS = [
  { label: '🌊 Brain dump', type: 'dump' as const, prompt: 'I need to get some thoughts out...' },
  { label: '🌅 Morning check-in', type: 'morning' as const, prompt: "I'm ready to start my day." },
  { label: '🌙 Evening wind-down', type: 'evening' as const, prompt: "Let me process today." },
  { label: '💬 Just talk', type: 'coach' as const, prompt: '' },
];

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [promptType, setPromptType] = useState<string>('coach');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const startSession = async (type: string, greeting?: string) => {
    const session = await createSession(type as any);
    setSessionId(session.id);
    setPromptType(type);
    setMessages([]);

    if (greeting) {
      // Use a timeout to let the state clear before sending
      setTimeout(() => handleSend(greeting, type), 50);
    }
  };

  const handleSend = async (text?: string, type?: string) => {
    const messageText = text || input;
    if (!messageText.trim() || isStreaming) return;

    const userMsg: Message = { role: 'user', content: messageText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    // Save user message
    if (sessionId) {
      await addMessageToSession(sessionId, 'user', messageText);
    }

    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Please set your API key in Settings first.' }]);
        return;
      }

      // Build context from recent entries
      const recentEntries = await getRecentEntries(5);
      const recentContext = recentEntries
        .map(e => `[${e.created.split('T')[0]}] ${e.body.substring(0, 200)}`)
        .join('\n');

      const chatMessages: Message[] = messages.map(m => ({ role: m.role, content: m.content }));
      const apiMessages = buildMessages(
        type as any || promptType as any,
        chatMessages,
        messageText,
        recentContext || undefined
      );

      let assistantContent = '';
      const assistantMsg: Message = { role: 'assistant', content: '' };
      setMessages(prev => [...prev, assistantMsg]);

      abortRef.current = new AbortController();

      for await (const chunk of streamChat(apiMessages, { apiKey, model }, abortRef.current.signal)) {
        assistantContent += chunk;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
          return updated;
        });
      }

      // Save assistant message
      if (sessionId) {
        await addMessageToSession(sessionId, 'assistant', assistantContent);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEndSession = async () => {
    if (sessionId) {
      await endSession(sessionId);
      setSessionId(null);
      setMessages([]);
      setPromptType('coach');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">AI Coach</h1>
          <p className="text-sm text-text-muted mt-1">
            {messages.length === 0
              ? 'Choose a mode or just start talking'
              : `${messages.length} messages · ${promptType} mode`
            }
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleEndSession}
            className="px-4 py-2 text-sm border border-border rounded-xl
                       text-text-secondary hover:text-accent-amber hover:border-accent-amber
                       transition-colors"
          >
            End session
          </button>
        )}
      </div>

      {/* Quick start buttons */}
      {messages.length === 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {QUICK_STARTS.map(qs => (
            <button
              key={qs.type}
              onClick={() => startSession(qs.type, qs.prompt)}
              className="p-4 bg-bg-card border border-border rounded-xl text-left
                         hover:border-accent-green hover:bg-bg-hover transition-all"
            >
              <span className="text-lg">{qs.label}</span>
              <p className="text-xs text-text-dim mt-1">
                {qs.type === 'dump' && 'Get it all out, no filter'}
                {qs.type === 'morning' && 'Set your intention for the day'}
                {qs.type === 'evening' && 'Process what happened'}
                {qs.type === 'coach' && 'Open conversation'}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-accent-green text-bg-primary rounded-br-md'
                  : 'bg-bg-card border border-border text-text-secondary rounded-bl-md'
              }`}
            >
              {msg.content || (
                <span className="inline-flex gap-1">
                  <span className="animate-pulse-gentle">·</span>
                  <span className="animate-pulse-gentle" style={{ animationDelay: '0.2s' }}>·</span>
                  <span className="animate-pulse-gentle" style={{ animationDelay: '0.4s' }}>·</span>
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'AI is thinking...' : 'Type a message...'}
          disabled={isStreaming}
          rows={1}
          className="flex-1 px-4 py-3 bg-bg-input border border-border rounded-xl
                     text-text-primary placeholder:text-text-dim resize-none
                     focus:border-accent-green focus:ring-1 focus:ring-accent-green
                     transition-colors disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            onClick={handleStop}
            className="px-4 py-3 bg-accent-amber text-bg-primary rounded-xl
                       hover:bg-accent-amber/90 transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="px-4 py-3 bg-accent-green text-bg-primary rounded-xl
                       hover:bg-accent-green/90 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { createSession, addMessageToSession, endSession, getRecentEntries, getPersonality } from '../db';
import { streamChat } from '../ai/openrouter';
import { buildCoachMessages, REQUEST_CONFIG, type CoachMode, type Personality } from '../ai/prompts';
import { getModel, getApiKey } from '../db';

type Message = { role: 'user' | 'assistant'; content: string };

const QUICK_STARTS: { label: string; mode: CoachMode; prompt: string; desc: string }[] = [
  { label: '🌊 Brain dump', mode: 'brain_dump', prompt: 'I need to get some thoughts out...', desc: 'Get it all out, no filter' },
  { label: '🌅 Morning check-in', mode: 'morning_checkin', prompt: "I'm ready to start my day.", desc: 'Set your intention for the day' },
  { label: '🌙 Evening wind-down', mode: 'evening_winddown', prompt: "Let me process today.", desc: 'Process what happened' },
  { label: '💬 Just talk', mode: 'just_talk', prompt: '', desc: 'Open conversation' },
];

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<CoachMode>('just_talk');
  const [personality, setPersonality] = useState<Personality>('coach');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Cleanup: abort any in-flight stream when component unmounts
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Load personality from settings
  useEffect(() => {
    getPersonality().then(p => setPersonality(p as Personality || 'coach'));
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const startSession = async (mode: CoachMode, greeting?: string) => {
    // Map new mode names to the existing ChatSession promptType union
    const sessionType = mode === 'brain_dump' ? 'dump'
      : mode === 'morning_checkin' ? 'morning'
      : mode === 'evening_winddown' ? 'evening'
      : 'coach';
    const session = await createSession(sessionType as any);
    setSessionId(session.id);
    setCurrentMode(mode);
    setMessages([]);

    if (greeting) {
      handleSend(greeting, mode, session.id);
    }
  };

  const handleSend = async (text?: string, mode?: CoachMode, sessionIdOverride?: string) => {
    const messageText = text || input;
    if (!messageText.trim() || isStreaming) return;

    const userMsg: Message = { role: 'user', content: messageText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    // Save user message — use override if provided (avoids stale closure), else create session
    let currentSessionId = sessionIdOverride || sessionId;
    if (!currentSessionId) {
      const m = mode || currentMode;
      const sessionType = m === 'brain_dump' ? 'dump'
        : m === 'morning_checkin' ? 'morning'
        : m === 'evening_winddown' ? 'evening'
        : 'coach';
      const session = await createSession(sessionType as any);
      currentSessionId = session.id;
      setSessionId(session.id);
    }
    await addMessageToSession(currentSessionId, 'user', messageText);

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

      const chatMessages: Message[] = messagesRef.current.map(m => ({ role: m.role, content: m.content }));
      const apiMessages = buildCoachMessages(
        mode || currentMode,
        personality,
        chatMessages,
        messageText,
        recentContext || undefined,
      );

      let assistantContent = '';
      const assistantMsg: Message = { role: 'assistant', content: '' };
      setMessages(prev => [...prev, assistantMsg]);

      abortRef.current = new AbortController();

      for await (const chunk of streamChat(
        apiMessages,
        { apiKey, model },
        abortRef.current.signal,
        REQUEST_CONFIG.coach_chat,
      )) {
        assistantContent += chunk;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
          return updated;
        });
      }

      // Save assistant message
      if (currentSessionId) {
        await addMessageToSession(currentSessionId, 'assistant', assistantContent);
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
      setCurrentMode('just_talk');
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
              : `${messages.length} messages · ${currentMode.replace('_', ' ')} mode`
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
              key={qs.mode}
              onClick={() => startSession(qs.mode, qs.prompt)}
              className="p-4 bg-bg-card border border-border rounded-xl text-left
                         hover:border-accent-green hover:bg-bg-hover transition-all"
            >
              <span className="text-lg">{qs.label}</span>
              <p className="text-xs text-text-dim mt-1">{qs.desc}</p>
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

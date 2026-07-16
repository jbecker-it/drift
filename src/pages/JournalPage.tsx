import { useState, useEffect, useRef, useCallback } from 'react';
import { saveEntry, saveDraft, getRecentEntries, logMood, updateEntry, type JournalEntry } from '../db';
import { streamChat } from '../ai/openrouter';
import { getReflectionPrompt, buildMessages, ENCOURAGEMENT } from '../ai/prompts';
import { getModel, getApiKey } from '../db';

const MOODS = [
  { value: 1, emoji: '😞', label: 'Struggling' },
  { value: 2, emoji: '😐', label: 'Low' },
  { value: 3, emoji: '🙂', label: 'Okay' },
  { value: 4, emoji: '😊', label: 'Good' },
  { value: 5, emoji: '🤩', label: 'Great' },
];

export default function JournalPage() {
  const [body, setBody] = useState('');
  const [mood, setMood] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reflection, setReflection] = useState('');
  const [reflecting, setReflecting] = useState(false);
  const [recentEntries, setRecentEntries] = useState<JournalEntry[]>([]);
  const [wordCount, setWordCount] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent entries
  useEffect(() => {
    getRecentEntries(5).then(setRecentEntries);
  }, []);

  // Word count
  useEffect(() => {
    const words = body.split(/\s+/).filter(Boolean).length;
    setWordCount(words);
  }, [body]);

  // Auto-save draft
  const autoSave = useCallback(async (text: string) => {
    if (text.trim().length < 10) return;
    // Find existing draft or create new
    const drafts = recentEntries.filter(e => e.isDraft);
    if (drafts.length > 0) {
      await updateEntry(drafts[0].id, {
        body: text,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      });
    } else {
      await saveDraft(text);
    }
  }, [recentEntries]);

  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (body.trim().length >= 10) {
      autoSaveTimer.current = setTimeout(() => autoSave(body), 5000);
    }
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [body, autoSave]);

  const handleSave = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const entry = await saveEntry(body, mood);

      // Log mood
      if (mood) {
        await logMood(mood, entry.id);
      }

      setSaved(true);
      setBody('');
      setMood(undefined);
      setReflection('');

      // Get recent entries for context
      const entries = await getRecentEntries(5);
      setRecentEntries(entries);
    } finally {
      setSaving(false);
    }
  };

  const handleReflect = async () => {
    if (!body.trim()) return;
    setReflecting(true);
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) return;

      const messages = getReflectionPrompt(body);
      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model })) {
        result += chunk;
        setReflection(result);
      }

      // Save the reflection
      const entries = await getRecentEntries(1);
      if (entries.length > 0) {
        await updateEntry(entries[0].id, { aiReflection: result });
      }
    } catch (err) {
      setReflection('Could not generate reflection. Check your API key.');
    } finally {
      setReflecting(false);
    }
  };

  const handleSuggestTopics = async () => {
    setLoadingSuggestions(true);
    setShowSuggestions(true);
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) {
        setSuggestions(['Set up your API key in Settings to get topic suggestions.']);
        return;
      }

      // Build context from recent entries
      const recentContext = recentEntries
        .map(e => `[${e.created.split('T')[0]}] ${e.body.substring(0, 200)}`)
        .join('\n');

      const messages = buildMessages('topic', [], 'Suggest what I should write about today.', recentContext || undefined);
      let response = '';
      for await (const chunk of streamChat(messages, { apiKey, model })) {
        response += chunk;
      }

      // Parse suggestions from response
      const lines = response.split('\n').filter(l => l.trim());
      const parsed = lines.map(l => l.replace(/^[-•*\d.]+\s*/, '').trim()).filter(Boolean);
      setSuggestions(parsed.length > 0 ? parsed : [response]);
    } catch {
      setSuggestions(['Could not generate suggestions. Try again later.']);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Journal</h1>
          <p className="text-sm text-text-muted mt-1">What's on your mind?</p>
        </div>
        <button
          onClick={handleSuggestTopics}
          className="px-4 py-2 text-sm bg-bg-card border border-border rounded-xl
                     text-text-secondary hover:text-accent-amber hover:border-accent-amber
                     transition-colors"
        >
          💡 Suggest a topic
        </button>
      </div>

      {/* Topic suggestions */}
      {showSuggestions && (
        <div className="bg-bg-card border border-border rounded-xl p-4 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-accent-amber">Topic suggestions</h3>
            <button onClick={() => setShowSuggestions(false)} className="text-text-dim hover:text-text-secondary">✕</button>
          </div>
          {loadingSuggestions ? (
            <div className="text-text-muted text-sm animate-pulse-gentle">Thinking...</div>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() => { setBody(prev => prev ? prev + '\n\n' + s : s); setShowSuggestions(false); }}
                    className="text-left text-sm text-text-secondary hover:text-accent-green transition-colors w-full"
                  >
                    → {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Saved confirmation */}
      {saved && (
        <div className="bg-accent-green-dim border border-accent-green/30 rounded-xl p-4 animate-slide-up">
          <p className="text-accent-green text-sm font-medium">
            ✨ Entry saved! {ENCOURAGEMENT.firstEntry}
          </p>
        </div>
      )}

      {/* Editor */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Dump your thoughts here. No judgment."
          className="w-full min-h-[300px] p-5 bg-transparent text-text-primary
                     placeholder:text-text-dim resize-none leading-relaxed
                     focus:outline-none"
          autoFocus
        />

        {/* Bottom bar */}
        <div className="px-4 py-3 border-t border-border">
          {/* Mood selector */}
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs text-text-dim mr-1">Mood:</span>
            {MOODS.map(m => (
              <button
                key={m.value}
                onClick={() => setMood(mood === m.value ? undefined : m.value)}
                className={`text-lg transition-transform hover:scale-110 ${
                  mood === m.value ? 'scale-125 ring-2 ring-accent-green rounded-full' : 'opacity-50'
                }`}
                title={m.label}
              >
                {m.emoji}
              </button>
            ))}
          </div>

          {/* Actions row */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-dim shrink-0">
              {wordCount > 0 ? `${wordCount} word${wordCount !== 1 ? 's' : ''}` : ''}
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={handleReflect}
                disabled={!body.trim() || reflecting}
                className="px-3 py-2 text-xs bg-bg-secondary border border-border rounded-lg
                           text-text-secondary hover:text-accent-purple hover:border-accent-purple
                           transition-colors disabled:opacity-40 shrink-0"
              >
                {reflecting ? 'Reflecting...' : '🪞 Reflect'}
              </button>

              <button
                onClick={handleSave}
                disabled={!body.trim() || saving}
                className="px-4 py-2 text-xs bg-accent-green text-bg-primary font-medium rounded-lg
                           hover:bg-accent-green/90 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard shortcut hint */}
      <p className="text-xs text-text-dim text-center">
        Ctrl+Enter to save
      </p>

      {/* AI Reflection */}
      {reflection && (
        <div className="bg-bg-card border border-accent-purple/30 rounded-xl p-5 animate-slide-up">
          <h3 className="text-sm font-medium text-accent-purple mb-2">🪞 Reflection</h3>
          <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">
            {reflection}
          </p>
        </div>
      )}

      {/* Recent entries */}
      {recentEntries.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-muted">Recent entries</h3>
          {recentEntries.slice(0, 3).map(entry => (
            <div key={entry.id} className="bg-bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-dim">
                  {new Date(entry.created).toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric'
                  })}
                </span>
                {entry.mood && (
                  <span className="text-lg">{MOODS[entry.mood - 1]?.emoji}</span>
                )}
              </div>
              <p className="text-sm text-text-secondary line-clamp-3">{entry.body}</p>
              {entry.aiReflection && (
                <p className="text-xs text-accent-purple mt-2 italic line-clamp-2">
                  🪞 {entry.aiReflection}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

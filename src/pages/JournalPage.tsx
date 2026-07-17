import { useState, useEffect, useRef, useCallback } from 'react';
import {
  saveEntry, saveDraft, getRecentEntries, logMood, updateEntry, deleteEntry, db,
  type JournalEntry,
} from '../db';
import { streamChat } from '../ai/openrouter';
import { getReflectionPrompt, buildMessages, REQUEST_CONFIG } from '../ai/prompts';
import { tagEntry } from '../ai/tagging';
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
  const [wordCount, setWordCount] = useState(0);
  const [recentEntries, setRecentEntries] = useState<JournalEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ─── Post-save reflection state ────────────────────
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [reflection, setReflection] = useState('');
  const [reflecting, setReflecting] = useState(false);
  const [showContinue, setShowContinue] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup: abort any in-flight streams when component unmounts
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadEntries = useCallback(async () => {
    const entries = await getRecentEntries(10);
    setRecentEntries(entries);
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    setWordCount(body.split(/\s+/).filter(Boolean).length);
  }, [body]);

  // Auto-save draft
  const autoSave = useCallback(async (text: string) => {
    if (text.trim().length < 10) return;
    if (draftIdRef.current) {
      await updateEntry(draftIdRef.current, { body: text, wordCount: text.split(/\s+/).filter(Boolean).length });
    } else {
      const draft = await saveDraft(text);
      draftIdRef.current = draft.id;
    }
  }, []);

  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (body.trim().length >= 10 && !activeEntryId) {
      autoSaveTimer.current = setTimeout(() => autoSave(body), 5000);
    }
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [body, autoSave, activeEntryId]);

  // ─── Auto-reflect after save ───────────────────────
  const runReflection = async (entryBody: string, entryId: string) => {
    setReflecting(true);
    setReflection('');
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) { setReflection('Set your API key in Settings first.'); return; }

      // Abort any previous in-flight stream
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const messages = getReflectionPrompt(entryBody);
      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model }, abortRef.current.signal, REQUEST_CONFIG.reflect)) {
        result += chunk;
        setReflection(result);
      }
      await updateEntry(entryId, { aiReflection: result });
      await loadEntries();
    } catch {
      setReflection('Could not generate reflection. Check your API key and model.');
    } finally {
      setReflecting(false);
    }
  };

  // ─── Save (new entry or update existing) ───────────
  const handleSave = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      let entryId = activeEntryId;

      if (entryId) {
        // Updating existing entry (continue writing)
        await updateEntry(entryId, {
          body,
          mood,
          wordCount: body.split(/\s+/).filter(Boolean).length,
        });
      } else {
        // New entry
        const entry = await saveEntry(body, mood);
        entryId = entry.id;
        if (mood) await logMood(mood, entry.id);
        setActiveEntryId(entryId);
        // Clean up any auto-saved draft
        if (draftIdRef.current) {
          await deleteEntry(draftIdRef.current);
          draftIdRef.current = null;
        }

        // Fire-and-forget: auto-tag the entry in the background
        tagEntry({ id: entry.id, body, created: entry.created, isDraft: false, wordCount: entry.wordCount });
      }

      await loadEntries();

      // Auto-reflect on save
      await runReflection(body, entryId!);

      // Show continue option
      setShowContinue(true);
    } finally {
      setSaving(false);
    }
  };

  // ─── Continue writing (load entry back into editor) ──
  const handleContinue = async () => {
    if (!activeEntryId) return;
    const entry = await db.entries.get(activeEntryId);
    if (entry) {
      setBody(entry.body);
      setMood(entry.mood);
      setShowContinue(false);
      setReflection('');
      setActiveEntryId(entry.id);
      textareaRef.current?.focus();
    }
  };

  // ─── Done (finish this entry) ──────────────────────
  const handleDone = () => {
    setBody('');
    setMood(undefined);
    setReflection('');
    setActiveEntryId(null);
    setShowContinue(false);
    draftIdRef.current = null;
  };

  // ─── Reflect on demand (while editing) ─────────────
  const handleReflectNow = async () => {
    if (!body.trim()) return;
    setReflecting(true);
    setReflection('');
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) { setReflection('Set your API key in Settings.'); return; }

      // Abort any previous in-flight stream
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const messages = getReflectionPrompt(body);
      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model }, abortRef.current.signal, REQUEST_CONFIG.reflect)) {
        result += chunk;
        setReflection(result);
      }
    } catch {
      setReflection('Could not generate reflection.');
    } finally {
      setReflecting(false);
    }
  };

  // ─── Expand / Edit / Delete (recent entries) ───────
  const handleEditEntry = (entry: JournalEntry) => {
    setActiveEntryId(entry.id);
    setBody(entry.body);
    setMood(entry.mood);
    setReflection('');
    setShowContinue(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setConfirmDelete(null);
    setExpandedEntry(null);
    if (activeEntryId === id) handleDone();
    await loadEntries();
  };

  const handleReflectSaved = async (entry: JournalEntry) => {
    const id = entry.id;
    setRecentEntries(prev => prev.map(e => e.id === id ? { ...e, aiReflection: '...' } : e));
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) return;

      // Abort any previous in-flight stream
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const messages = getReflectionPrompt(entry.body);
      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model }, abortRef.current.signal, REQUEST_CONFIG.reflect)) {
        result += chunk;
        setRecentEntries(prev => prev.map(e => e.id === id ? { ...e, aiReflection: result } : e));
      }
      await updateEntry(id, { aiReflection: result });
    } catch {
      setRecentEntries(prev => prev.map(e => e.id === id ? { ...e, aiReflection: 'Error.' } : e));
    }
  };

  // ─── Topic suggestions ─────────────────────────────
  const handleSuggestTopics = async () => {
    setLoadingSuggestions(true);
    setShowSuggestions(true);
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) { setSuggestions(['Set your API key in Settings to get topic suggestions.']); return; }
      const recentContext = recentEntries.map(e => `[${e.created.split('T')[0]}] ${e.body.substring(0, 200)}`).join('\n');

      // Abort any previous in-flight stream
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const messages = buildMessages('topic', [], 'Suggest what I should write about today.', recentContext || undefined);
      let response = '';
      for await (const chunk of streamChat(messages, { apiKey, model }, abortRef.current.signal, REQUEST_CONFIG.topic_suggest)) { response += chunk; }
      const lines = response.split('\n').filter(l => l.trim());
      const parsed = lines.map(l => l.replace(/^[-•*\d.]+\s*/, '').trim()).filter(Boolean);
      setSuggestions(parsed.length > 0 ? parsed : [response]);
    } catch {
      setSuggestions(['Could not generate suggestions.']);
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

  const isEditing = !!activeEntryId;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {isEditing ? '✏️ Continue writing' : 'Journal'}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {isEditing ? 'Your entry is saved. Add more or tap Done.' : "What's on your mind?"}
          </p>
        </div>
        <button
          onClick={handleSuggestTopics}
          className="px-3 py-2 text-sm bg-bg-card border border-border rounded-xl
                     text-text-secondary hover:text-accent-amber hover:border-accent-amber
                     transition-colors"
        >
          💡 Topic
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

      {/* Editor */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Dump your thoughts here. No judgment."
          className="w-full min-h-[250px] p-5 bg-transparent text-text-primary
                     placeholder:text-text-dim resize-none leading-relaxed
                     focus:outline-none"
          autoFocus
        />

        <div className="px-4 py-3 border-t border-border">
          {/* Mood row */}
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

          {/* Actions */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-dim shrink-0">
              {wordCount > 0 ? `${wordCount} word${wordCount !== 1 ? 's' : ''}` : ''}
            </span>

            <div className="flex items-center gap-2">
              {isEditing && (
                <button
                  onClick={handleDone}
                  className="px-3 py-2 text-xs border border-border rounded-lg
                             text-text-secondary hover:bg-bg-hover transition-colors shrink-0"
                >
                  Done
                </button>
              )}

              <button
                onClick={handleReflectNow}
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
                {saving ? 'Saving...' : isEditing ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-text-dim text-center">Ctrl+Enter to save</p>

      {/* ─── Post-save: Reflection + Continue ──────── */}
      {reflection && (
        <div className="bg-bg-card border border-accent-purple/30 rounded-xl p-5 animate-slide-up space-y-3">
          <h3 className="text-sm font-medium text-accent-purple">🪞 Reflection</h3>
          <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">{reflection}</p>

          {showContinue && (
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <button
                onClick={handleContinue}
                className="px-4 py-2 text-xs bg-accent-blue/10 border border-accent-blue/30
                           text-accent-blue rounded-lg hover:bg-accent-blue/20 transition-colors"
              >
                ✏️ Continue writing
              </button>
              <button
                onClick={handleDone}
                className="px-4 py-2 text-xs bg-bg-secondary border border-border
                           text-text-secondary rounded-lg hover:bg-bg-hover transition-colors"
              >
                ✓ Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Recent entries ────────────────────────── */}
      {recentEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text-muted">Recent entries</h3>
          {recentEntries.map(entry => {
            const isExpanded = expandedEntry === entry.id;
            return (
              <div key={entry.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                  className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-dim">
                      {new Date(entry.created).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-dim">{entry.wordCount}w</span>
                      {entry.mood && <span className="text-sm">{MOODS[entry.mood - 1]?.emoji}</span>}
                      <span className="text-text-dim text-xs">{isExpanded ? '▾' : '▸'}</span>
                    </div>
                  </div>
                  <p className="text-sm text-text-secondary mt-1 line-clamp-2">{entry.body}</p>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-3 border-t border-border animate-slide-up">
                    <p className="text-sm text-text-secondary leading-relaxed mt-3 whitespace-pre-wrap">{entry.body}</p>

                    {entry.aiReflection && (
                      <div className="mt-3 p-3 bg-accent-purple/5 border border-accent-purple/20 rounded-lg">
                        <p className="text-xs text-accent-purple font-medium mb-1">🪞 Reflection</p>
                        <p className="text-xs text-text-secondary leading-relaxed">{entry.aiReflection}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => handleReflectSaved(entry)}
                        className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg
                                   text-text-secondary hover:text-accent-purple hover:border-accent-purple transition-colors"
                      >
                        🪞 Reflect
                      </button>
                      <button
                        onClick={() => { handleEditEntry(entry); setExpandedEntry(null); }}
                        className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg
                                   text-text-secondary hover:text-accent-blue hover:border-accent-blue transition-colors"
                      >
                        ✏️ Edit
                      </button>
                      {confirmDelete === entry.id ? (
                        <div className="flex items-center gap-1 ml-auto">
                          <button onClick={() => handleDelete(entry.id)}
                            className="px-3 py-1.5 text-xs bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/30 transition-colors">
                            Delete
                          </button>
                          <button onClick={() => setConfirmDelete(null)}
                            className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-dim hover:bg-bg-hover transition-colors">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(entry.id)}
                          className="px-3 py-1.5 text-xs border border-border rounded-lg text-text-dim hover:text-red-400 hover:border-red-500/30 transition-colors ml-auto">
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Need db import for handleContinue
// db already imported at top

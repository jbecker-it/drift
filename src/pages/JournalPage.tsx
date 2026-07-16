import { useState, useEffect, useRef, useCallback } from 'react';
import {
  saveEntry, saveDraft, getRecentEntries, logMood, updateEntry, deleteEntry,
  type JournalEntry,
} from '../db';
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
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEntries = useCallback(async () => {
    const entries = await getRecentEntries(10);
    setRecentEntries(entries);
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    const words = body.split(/\s+/).filter(Boolean).length;
    setWordCount(words);
  }, [body]);

  // Auto-save draft
  const autoSave = useCallback(async (text: string) => {
    if (text.trim().length < 10) return;
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
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [body, autoSave]);

  const handleSave = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const entry = await saveEntry(body, mood);
      if (mood) await logMood(mood, entry.id);
      setSaved(true);
      setBody('');
      setMood(undefined);
      setReflection('');
      await loadEntries();
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  // ─── Reflect on current editor text ────────────────
  const handleReflect = async () => {
    if (!body.trim()) return;
    setReflecting(true);
    setReflection('');
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) { setReflection('Set your API key in Settings first.'); return; }

      const messages = getReflectionPrompt(body);
      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model })) {
        result += chunk;
        setReflection(result);
      }
    } catch {
      setReflection('Could not generate reflection. Check your API key and model.');
    } finally {
      setReflecting(false);
    }
  };

  // ─── Reflect on a SAVED entry ──────────────────────
  const handleReflectSaved = async (entry: JournalEntry) => {
    const entryId = entry.id;
    // Set reflecting state on this entry
    setRecentEntries(prev => prev.map(e =>
      e.id === entryId ? { ...e, aiReflection: '...' } : e
    ));

    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) return;

      const messages = getReflectionPrompt(entry.body);
      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model })) {
        result += chunk;
        setRecentEntries(prev => prev.map(e =>
          e.id === entryId ? { ...e, aiReflection: result } : e
        ));
      }
      await updateEntry(entryId, { aiReflection: result });
    } catch {
      setRecentEntries(prev => prev.map(e =>
        e.id === entryId ? { ...e, aiReflection: 'Could not generate reflection.' } : e
      ));
    }
  };

  // ─── Edit a saved entry ────────────────────────────
  const handleEditEntry = (entry: JournalEntry) => {
    setEditingEntry(entry);
    setBody(entry.body);
    setMood(entry.mood);
    setReflection('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveEdit = async () => {
    if (!editingEntry || !body.trim()) return;
    setSaving(true);
    try {
      await updateEntry(editingEntry.id, {
        body,
        mood,
        wordCount: body.split(/\s+/).filter(Boolean).length,
      });
      setEditingEntry(null);
      setBody('');
      setMood(undefined);
      setReflection('');
      await loadEntries();
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingEntry(null);
    setBody('');
    setMood(undefined);
    setReflection('');
  };

  // ─── Delete ────────────────────────────────────────
  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setConfirmDelete(null);
    setExpandedEntry(null);
    await loadEntries();
  };

  // ─── Topic suggestions ─────────────────────────────
  const handleSuggestTopics = async () => {
    setLoadingSuggestions(true);
    setShowSuggestions(true);
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) { setSuggestions(['Set your API key in Settings to get topic suggestions.']); return; }

      const recentContext = recentEntries
        .map(e => `[${e.created.split('T')[0]}] ${e.body.substring(0, 200)}`)
        .join('\n');

      const messages = buildMessages('topic', [], 'Suggest what I should write about today.', recentContext || undefined);
      let response = '';
      for await (const chunk of streamChat(messages, { apiKey, model })) {
        response += chunk;
      }
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
      editingEntry ? handleSaveEdit() : handleSave();
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {editingEntry ? '✏️ Editing entry' : 'Journal'}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {editingEntry ? 'Make your changes, then save' : "What's on your mind?"}
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

      {/* Saved confirmation */}
      {saved && (
        <div className="bg-accent-green-dim border border-accent-green/30 rounded-xl p-4 animate-slide-up">
          <p className="text-accent-green text-sm font-medium">✨ {ENCOURAGEMENT.firstEntry}</p>
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

          {/* Actions row */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-dim shrink-0">
              {wordCount > 0 ? `${wordCount} word${wordCount !== 1 ? 's' : ''}` : ''}
            </span>

            <div className="flex items-center gap-2">
              {editingEntry && (
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-2 text-xs border border-border rounded-lg
                             text-text-secondary hover:bg-bg-hover transition-colors shrink-0"
                >
                  Cancel
                </button>
              )}

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
                onClick={editingEntry ? handleSaveEdit : handleSave}
                disabled={!body.trim() || saving}
                className="px-4 py-2 text-xs bg-accent-green text-bg-primary font-medium rounded-lg
                           hover:bg-accent-green/90 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {saving ? 'Saving...' : editingEntry ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-text-dim text-center">Ctrl+Enter to save</p>

      {/* AI Reflection (on current text) */}
      {reflection && (
        <div className="bg-bg-card border border-accent-purple/30 rounded-xl p-5 animate-slide-up">
          <h3 className="text-sm font-medium text-accent-purple mb-2">🪞 Reflection</h3>
          <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">{reflection}</p>
        </div>
      )}

      {/* Recent entries */}
      {recentEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text-muted">Recent entries</h3>
          {recentEntries.map(entry => {
            const isExpanded = expandedEntry === entry.id;
            return (
              <div key={entry.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                {/* Collapsed view — tap to expand */}
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

                {/* Expanded view */}
                {isExpanded && (
                  <div className="px-4 pb-3 border-t border-border animate-slide-up">
                    <p className="text-sm text-text-secondary leading-relaxed mt-3 whitespace-pre-wrap">
                      {entry.body}
                    </p>

                    {/* AI Reflection on saved entry */}
                    {entry.aiReflection && (
                      <div className="mt-3 p-3 bg-accent-purple/5 border border-accent-purple/20 rounded-lg">
                        <p className="text-xs text-accent-purple font-medium mb-1">🪞 Reflection</p>
                        <p className="text-xs text-text-secondary leading-relaxed">{entry.aiReflection}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => handleReflectSaved(entry)}
                        className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg
                                   text-text-secondary hover:text-accent-purple hover:border-accent-purple
                                   transition-colors"
                      >
                        🪞 Reflect
                      </button>
                      <button
                        onClick={() => handleEditEntry(entry)}
                        className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg
                                   text-text-secondary hover:text-accent-blue hover:border-accent-blue
                                   transition-colors"
                      >
                        ✏️ Edit
                      </button>
                      {confirmDelete === entry.id ? (
                        <div className="flex items-center gap-1 ml-auto">
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="px-3 py-1.5 text-xs bg-red-500/20 border border-red-500/30 rounded-lg
                                       text-red-400 hover:bg-red-500/30 transition-colors"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="px-3 py-1.5 text-xs border border-border rounded-lg
                                       text-text-dim hover:bg-bg-hover transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(entry.id)}
                          className="px-3 py-1.5 text-xs border border-border rounded-lg
                                     text-text-dim hover:text-red-400 hover:border-red-500/30
                                     transition-colors ml-auto"
                        >
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

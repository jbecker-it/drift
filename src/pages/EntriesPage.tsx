import { useState, useEffect, useMemo } from 'react';
import { db, deleteEntry, updateEntry, type JournalEntry } from '../db';
import { streamChat } from '../ai/openrouter';
import { getReflectionPrompt } from '../ai/prompts';
import { getModel, getApiKey } from '../db';

const MOODS = [
  { value: 1, emoji: '😞' },
  { value: 2, emoji: '😐' },
  { value: 3, emoji: '🙂' },
  { value: 4, emoji: '😊' },
  { value: 5, emoji: '🤩' },
];

type Filter = 'all' | 'today' | 'week' | 'month';

export default function EntriesPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editMood, setEditMood] = useState<number | undefined>();

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const all = await db.entries.orderBy('created').reverse().toArray();
    setEntries(all);
  };

  const filtered = useMemo(() => {
    const now = new Date();
    return entries.filter(e => {
      const d = new Date(e.created);
      if (filter === 'today') {
        return d.toDateString() === now.toDateString();
      }
      if (filter === 'week') {
        return (now.getTime() - d.getTime()) < 7 * 86400000;
      }
      if (filter === 'month') {
        return (now.getTime() - d.getTime()) < 30 * 86400000;
      }
      return true;
    });
  }, [entries, filter]);

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    setConfirmDelete(null);
    setExpandedEntry(null);
    await loadAll();
  };

  const handleStartEdit = (entry: JournalEntry) => {
    setEditingEntry(entry);
    setEditBody(entry.body);
    setEditMood(entry.mood);
  };

  const handleSaveEdit = async () => {
    if (!editingEntry || !editBody.trim()) return;
    await updateEntry(editingEntry.id, {
      body: editBody,
      mood: editMood,
      wordCount: editBody.split(/\s+/).filter(Boolean).length,
    });
    setEditingEntry(null);
    await loadAll();
  };

  const handleReflect = async (entry: JournalEntry) => {
    const id = entry.id;
    setEntries(prev => prev.map(e => e.id === id ? { ...e, aiReflection: '...' } : e));
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey) return;
      const messages = getReflectionPrompt(entry.body);
      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model })) {
        result += chunk;
        setEntries(prev => prev.map(e => e.id === id ? { ...e, aiReflection: result } : e));
      }
      await updateEntry(id, { aiReflection: result });
    } catch {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, aiReflection: 'Error.' } : e));
    }
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">All entries</h1>
          <p className="text-sm text-text-muted mt-1">{filtered.length} {filter !== 'all' ? `of ${entries.length}` : ''} entries</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              filter === f.key
                ? 'bg-accent-green text-bg-primary font-medium'
                : 'bg-bg-card border border-border text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Entry list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <p className="text-lg mb-2">📝</p>
          <p>No entries {filter !== 'all' ? 'in this period' : 'yet'}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(entry => {
            const isExpanded = expandedEntry === entry.id;
            const isEditing = editingEntry?.id === entry.id;

            return (
              <div key={entry.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                {/* Header — tap to expand */}
                <button
                  onClick={() => !isEditing && setExpandedEntry(isExpanded ? null : entry.id)}
                  className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-dim">
                      {new Date(entry.created).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-dim">{entry.wordCount}w</span>
                      {entry.mood && <span className="text-sm">{MOODS[entry.mood - 1]?.emoji}</span>}
                      {!isEditing && <span className="text-text-dim text-xs">{isExpanded ? '▾' : '▸'}</span>}
                    </div>
                  </div>
                  <p className="text-sm text-text-secondary mt-1 line-clamp-2">{entry.body}</p>
                </button>

                {/* Expanded / editing */}
                {(isExpanded || isEditing) && (
                  <div className="px-4 pb-4 border-t border-border animate-slide-up">
                    {isEditing ? (
                      /* Edit mode */
                      <div className="space-y-3 mt-3">
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          className="w-full min-h-[150px] p-3 bg-bg-input border border-border rounded-xl
                                     text-text-primary text-sm resize-none focus:outline-none
                                     focus:border-accent-green"
                          autoFocus
                        />
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-text-dim">Mood:</span>
                          {MOODS.map(m => (
                            <button
                              key={m.value}
                              onClick={() => setEditMood(editMood === m.value ? undefined : m.value)}
                              className={`text-base transition-transform hover:scale-110 ${
                                editMood === m.value ? 'scale-125 ring-2 ring-accent-green rounded-full' : 'opacity-50'
                              }`}
                            >
                              {m.emoji}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveEdit}
                            className="px-4 py-1.5 text-xs bg-accent-green text-bg-primary font-medium rounded-lg
                                       hover:bg-accent-green/90 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingEntry(null)}
                            className="px-4 py-1.5 text-xs border border-border rounded-lg
                                       text-text-secondary hover:bg-bg-hover transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <>
                        <p className="text-sm text-text-secondary leading-relaxed mt-3 whitespace-pre-wrap">
                          {entry.body}
                        </p>

                        {entry.aiReflection && (
                          <div className="mt-3 p-3 bg-accent-purple/5 border border-accent-purple/20 rounded-lg">
                            <p className="text-xs text-accent-purple font-medium mb-1">🪞 Reflection</p>
                            <p className="text-xs text-text-secondary leading-relaxed">{entry.aiReflection}</p>
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-3">
                          <button
                            onClick={() => handleReflect(entry)}
                            className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg
                                       text-text-secondary hover:text-accent-purple hover:border-accent-purple
                                       transition-colors"
                          >
                            🪞 Reflect
                          </button>
                          <button
                            onClick={() => handleStartEdit(entry)}
                            className="px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg
                                       text-text-secondary hover:text-accent-blue hover:border-accent-blue
                                       transition-colors"
                          >
                            ✏️ Edit
                          </button>
                          {confirmDelete === entry.id ? (
                            <>
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
                            </>
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
                      </>
                    )}
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

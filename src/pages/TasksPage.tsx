import { useState, useEffect, useRef, useCallback } from 'react';
import {
  addTask, toggleTask, deleteTask, getTodaysTasks,
  addTodo, getOpenTodos, isOverdue, isDueToday, isDueThisWeek, moveTemplateToPreset,
  reorderTemplate,
  createTaskTemplate, deleteTaskTemplate, getTemplatesWithStatus,
  ensureDailyPresetInstances, ensureWeeklyTaskInstances, getWeeklyTaskInstances,
  type Task, type TaskTemplate,
} from '../db';

type Tab = 'daily' | 'weekly' | 'todos' | 'custom';

const PRESET_ICONS: Record<string, string> = {
  morning: '🌅',
  midday: '☀️',
  afternoon: '🌤️',
  night: '🌙',
};

const PRESET_ORDER: TaskTemplate['preset'][] = ['morning', 'midday', 'afternoon', 'night'];

export default function TasksPage() {
  const [tab, setTab] = useState<Tab>('daily');
  const [customTasks, setCustomTasks] = useState<Task[]>([]);
  const [presetData, setPresetData] = useState<{ template: TaskTemplate; instance?: Task }[]>([]);
  const [weeklyData, setWeeklyData] = useState<{ template: TaskTemplate; done: number; total: number; frequency: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add task states
  const [newCustomTask, setNewCustomTask] = useState('');
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [showAddWeekly, setShowAddWeekly] = useState(false);
  const [newPresetText, setNewPresetText] = useState('');
  const [newPresetSlot, setNewPresetSlot] = useState<TaskTemplate['preset']>('morning');
  const [newWeeklyText, setNewWeeklyText] = useState('');
  const [newWeeklyFreq, setNewWeeklyFreq] = useState(2);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<string | null>(null);

  // To-do states
  const [todos, setTodos] = useState<Task[]>([]);
  const [newTodoText, setNewTodoText] = useState('');
  const [newTodoDue, setNewTodoDue] = useState('');

  // Move menu state (keyboard accessible)
  const [openMoveMenu, setOpenMoveMenu] = useState<string | null>(null);

  // Weekly refresh token — increments to force WeeklyCheckboxes re-render
  const [weeklyRefresh, setWeeklyRefresh] = useState(0);

  // Mutation lock — prevents overlapping loadAll calls
  const mutationLock = useRef(false);
  const pendingReload = useRef(false);

  const customInputRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    if (mutationLock.current) { pendingReload.current = true; return; }
    mutationLock.current = true;
    try {
      setError(null);
      await ensureDailyPresetInstances();
      await ensureWeeklyTaskInstances();

      const today = await getTodaysTasks();
      setCustomTasks(today.filter(t => !t.templateId && t.type !== 'todo').sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.createdAt.localeCompare(b.createdAt);
      }));

      const status = await getTemplatesWithStatus();
      setPresetData(status.presets);
      setWeeklyData(status.weekly);

      const openTodos = await getOpenTodos();
      setTodos(openTodos);
    } catch (err: any) {
      setError(err.message || 'Failed to load tasks');
    } finally {
      setIsLoading(false);
      mutationLock.current = false;
      if (pendingReload.current) {
        pendingReload.current = false;
        loadAll();
      }
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Close move menu on outside click
  useEffect(() => {
    if (!openMoveMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-move-menu]')) {
        setOpenMoveMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMoveMenu]);

  // ─── Custom tasks handlers ─────────────────────────

  const handleAddCustom = async () => {
    const text = newCustomTask.trim();
    if (!text) return;
    await addTask(text);
    setNewCustomTask('');
    customInputRef.current?.focus();
    await loadAll();
  };

  const handleToggleCustom = async (id: string) => {
    await toggleTask(id);
    await loadAll();
  };

  const handleDeleteCustom = async (id: string) => {
    await deleteTask(id);
    setConfirmDelete(null);
    await loadAll();
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddCustom(); }
  };

  // ─── Preset template handlers ──────────────────────

  const handleAddPreset = async () => {
    const text = newPresetText.trim();
    if (!text) return;
    await createTaskTemplate(text, 'preset', newPresetSlot);
    setNewPresetText('');
    setShowAddPreset(false);
    await loadAll();
  };

  const handleTogglePreset = async (task: Task) => {
    if (task) await toggleTask(task.id);
    await loadAll();
  };

  const handleDeletePresetTemplate = async (id: string) => {
    await deleteTaskTemplate(id);
    setConfirmDeleteTemplate(null);
    await loadAll();
  };

  const handleMovePreset = async (templateId: string, newPreset: TaskTemplate['preset']) => {
    await moveTemplateToPreset(templateId, newPreset);
    setOpenMoveMenu(null);
    await loadAll();
  };

  const handleReorder = async (templateId: string, direction: 'up' | 'down') => {
    await reorderTemplate(templateId, direction);
    await loadAll();
  };

  // ─── Weekly template handlers ──────────────────────

  const handleAddWeekly = async () => {
    const text = newWeeklyText.trim();
    if (!text) return;
    await createTaskTemplate(text, 'weekly', undefined, newWeeklyFreq);
    setNewWeeklyText('');
    setNewWeeklyFreq(2);
    setShowAddWeekly(false);
    await loadAll();
  };

  const handleToggleWeekly = async (task: Task) => {
    await toggleTask(task.id);
    await loadAll();
    setWeeklyRefresh(n => n + 1); // Force WeeklyCheckboxes to re-fetch
  };

  const handleDeleteWeeklyTemplate = async (id: string) => {
    await deleteTaskTemplate(id);
    setConfirmDeleteTemplate(null);
    await loadAll();
  };

  // ─── To-do handlers ───────────────────────────────

  const handleAddTodo = async () => {
    const text = newTodoText.trim();
    if (!text) return;
    await addTodo(text, newTodoDue || undefined);
    setNewTodoText('');
    setNewTodoDue('');
    await loadAll();
  };

  const handleToggleTodo = async (id: string) => {
    await toggleTask(id);
    await loadAll();
  };

  const handleDeleteTodo = async (id: string) => {
    await deleteTask(id);
    setConfirmDelete(null);
    await loadAll();
  };

  const handleTodoKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddTodo(); }
  };

  // ─── Render ────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'daily', label: 'Daily', icon: '📅' },
    { key: 'weekly', label: 'Weekly', icon: '📆' },
    { key: 'todos', label: 'To-Dos', icon: '📋' },
    { key: 'custom', label: 'Custom', icon: '✏️' },
  ];

  if (isLoading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h1 className="text-2xl font-bold text-text-primary">Tasks</h1>
        <div className="text-center py-12 text-text-dim animate-pulse-gentle">Loading tasks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h1 className="text-2xl font-bold text-text-primary">Tasks</h1>
        <div className="text-center py-12">
          <p className="text-red-400 mb-3">{error}</p>
          <button onClick={loadAll} className="px-4 py-2 bg-accent-green text-bg-primary rounded-xl text-sm font-medium hover:bg-accent-green/90 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Tasks</h1>
        <p className="text-sm text-text-muted mt-1">Manage your daily routines and weekly goals</p>
      </div>

      {/* Tab bar */}
      <div role="tablist" className="flex gap-1 bg-bg-card border border-border rounded-xl p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${t.key}-panel`}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-accent-green/15 text-accent-green'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
            }`}
          >
            <span aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ─── DAILY PRESETS TAB ──────────────────────── */}
      {tab === 'daily' && (
        <div role="tabpanel" id="daily-panel" aria-label="Daily preset tasks" className="space-y-4">
          {/* Preset sections by time of day */}
          {PRESET_ORDER.map(slot => {
            const items = presetData.filter(p => p.template.preset === slot);
            if (items.length === 0 && !showAddPreset) return null;
            const done = items.filter(p => p.instance?.done).length;
            return (
              <div key={slot} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-lg" aria-hidden="true">{slot ? PRESET_ICONS[slot] : ''}</span>
                  <span className="text-sm font-medium text-text-secondary capitalize">{slot}</span>
                  {items.length > 0 && (
                    <span className="text-xs text-text-dim ml-auto">{done}/{items.length}</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {items.map(({ template, instance }, idx) => (
                    <div
                      key={template.id}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                        instance?.done
                          ? 'bg-bg-card border-border opacity-60'
                          : 'bg-bg-card border-border hover:border-accent-green/30'
                      }`}
                    >
                      <button
                        onClick={() => handleTogglePreset(instance!)}
                        disabled={!instance}
                        aria-label={`Toggle "${template.text}"`}
                        className={`shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                          instance?.done
                            ? 'bg-accent-green border-accent-green text-bg-primary'
                            : 'border-border hover:border-accent-green'
                        }`}
                      >
                        {instance?.done && (
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <span className={`flex-1 text-sm transition-all ${
                        instance?.done ? 'text-text-dim line-through' : 'text-text-primary'
                      }`}>
                        {template.text}
                      </span>

                      {/* Reorder buttons */}
                      <div className="flex flex-col shrink-0">
                        <button
                          onClick={() => handleReorder(template.id, 'up')}
                          disabled={idx === 0}
                          aria-label={`Move "${template.text}" up`}
                          className="text-text-dim hover:text-text-secondary transition-colors text-xs leading-none px-1 py-0.5 disabled:opacity-20 disabled:cursor-default"
                        >▲</button>
                        <button
                          onClick={() => handleReorder(template.id, 'down')}
                          disabled={idx === items.length - 1}
                          aria-label={`Move "${template.text}" down`}
                          className="text-text-dim hover:text-text-secondary transition-colors text-xs leading-none px-1 py-0.5 disabled:opacity-20 disabled:cursor-default"
                        >▼</button>
                      </div>

                      {/* Move to segment (keyboard accessible) */}
                      <div className="relative shrink-0" data-move-menu>
                        <button
                          onClick={() => setOpenMoveMenu(openMoveMenu === template.id ? null : template.id)}
                          aria-haspopup="menu"
                          aria-expanded={openMoveMenu === template.id}
                          aria-label={`Move "${template.text}" to another segment`}
                          className="text-text-dim hover:text-text-secondary transition-colors px-1"
                        >↗</button>
                        {openMoveMenu === template.id && (
                          <div role="menu" className="absolute right-0 top-full mt-1 z-10
                                          bg-bg-card border border-border rounded-xl shadow-lg py-1 min-w-[120px]">
                            {PRESET_ORDER.filter(s => s !== template.preset).map(s => (
                              <button
                                key={s}
                                role="menuitem"
                                onClick={() => handleMovePreset(template.id, s)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary
                                           hover:bg-bg-hover hover:text-text-primary transition-colors"
                              >
                                <span aria-hidden="true">{PRESET_ICONS[s || '']}</span>
                                <span className="capitalize">{s}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {confirmDeleteTemplate === template.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDeletePresetTemplate(template.id)}
                            className="px-2 py-1 text-xs bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/30 transition-colors"
                          >Delete</button>
                          <button
                            onClick={() => setConfirmDeleteTemplate(null)}
                            className="px-2 py-1 text-xs border border-border rounded-lg text-text-dim hover:bg-bg-hover transition-colors"
                          >Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteTemplate(template.id)}
                          aria-label={`Delete preset "${template.text}"`}
                          className="text-text-dim hover:text-red-400 transition-colors"
                        >✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Add preset form */}
          {showAddPreset ? (
            <div className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-sm font-medium text-text-secondary">New daily preset</p>
              <input
                type="text"
                value={newPresetText}
                onChange={e => setNewPresetText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddPreset(); } }}
                placeholder="e.g. Meditate for 5 min"
                autoFocus
                aria-label="Preset task name"
                className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-dim focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
              />
              <div role="group" aria-label="Time of day" className="flex gap-2">
                {PRESET_ORDER.map(slot => (
                  <button
                    key={slot}
                    role="radio"
                    aria-checked={newPresetSlot === slot}
                    onClick={() => setNewPresetSlot(slot)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                      newPresetSlot === slot
                        ? 'bg-accent-green/15 text-accent-green border border-accent-green/30'
                        : 'bg-bg-hover text-text-dim border border-border hover:text-text-secondary'
                    }`}
                  >
                    <span aria-hidden="true">{slot ? PRESET_ICONS[slot] : ''}</span>
                    <span className="capitalize">{slot}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddPreset}
                  disabled={!newPresetText.trim()}
                  className="flex-1 px-4 py-2.5 bg-accent-green text-bg-primary font-medium rounded-xl hover:bg-accent-green/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >Add Preset</button>
                <button
                  onClick={() => { setShowAddPreset(false); setNewPresetText(''); }}
                  className="px-4 py-2.5 border border-border rounded-xl text-text-dim hover:bg-bg-hover transition-colors"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddPreset(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-border rounded-xl text-text-dim hover:text-text-secondary hover:border-accent-green/30 transition-all"
            >
              <span className="text-lg" aria-hidden="true">+</span>
              <span className="text-sm">Add daily preset</span>
            </button>
          )}
        </div>
      )}

      {/* ─── WEEKLY TASKS TAB ───────────────────────── */}
      {tab === 'weekly' && (
        <div role="tabpanel" id="weekly-panel" aria-label="Weekly tasks" className="space-y-4">
          <p className="text-xs text-text-dim px-1">Tasks that repeat weekly — tick them off during the running week</p>

          {weeklyData.map(({ template, done, frequency }) => {
            const isComplete = done >= frequency;
            return (
              <div key={template.id} className="space-y-2">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-card border border-border">
                  <div className={`shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                    isComplete
                      ? 'bg-accent-green border-accent-green text-bg-primary'
                      : 'border-border'
                  }`}>
                    {isComplete && (
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm transition-all ${isComplete ? 'text-text-dim line-through' : 'text-text-primary'}`}>
                      {template.text}
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${isComplete ? 'text-accent-green' : 'text-text-muted'}`}>
                        {done}/{frequency}× this week
                      </span>
                      {/* Progress dots */}
                      <div className="flex gap-1" aria-label={`${done} of ${frequency} completions`}>
                        {Array.from({ length: frequency }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full transition-all ${
                              i < done ? 'bg-accent-green' : 'bg-border'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  {confirmDeleteTemplate === template.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDeleteWeeklyTemplate(template.id)}
                        className="px-2 py-1 text-xs bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/30 transition-colors"
                      >Delete</button>
                      <button
                        onClick={() => setConfirmDeleteTemplate(null)}
                        className="px-2 py-1 text-xs border border-border rounded-lg text-text-dim hover:bg-bg-hover transition-colors"
                      >Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteTemplate(template.id)}
                      aria-label={`Delete weekly task "${template.text}"`}
                      className="text-text-dim hover:text-red-400 transition-colors shrink-0"
                    >✕</button>
                  )}
                </div>

                {/* Individual checkboxes for each weekly instance */}
                <WeeklyCheckboxes templateId={template.id} onToggle={handleToggleWeekly} refreshToken={weeklyRefresh} />
              </div>
            );
          })}

          {/* Add weekly task form */}
          {showAddWeekly ? (
            <div className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-sm font-medium text-text-secondary">New weekly task</p>
              <input
                type="text"
                value={newWeeklyText}
                onChange={e => setNewWeeklyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddWeekly(); } }}
                placeholder="e.g. Go for a run"
                autoFocus
                aria-label="Weekly task name"
                className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-dim focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
              />
              <div>
                <label className="text-xs text-text-muted block mb-1.5">Times per week</label>
                <div role="group" aria-label="Frequency per week" className="flex gap-2">
                  {[1, 2, 3, 4, 5, 6, 7].map(n => (
                    <button
                      key={n}
                      role="radio"
                      aria-checked={newWeeklyFreq === n}
                      onClick={() => setNewWeeklyFreq(n)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                        newWeeklyFreq === n
                          ? 'bg-accent-green/15 text-accent-green border border-accent-green/30'
                          : 'bg-bg-hover text-text-dim border border-border hover:text-text-secondary'
                      }`}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddWeekly}
                  disabled={!newWeeklyText.trim()}
                  className="flex-1 px-4 py-2.5 bg-accent-green text-bg-primary font-medium rounded-xl hover:bg-accent-green/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >Add Weekly Task</button>
                <button
                  onClick={() => { setShowAddWeekly(false); setNewWeeklyText(''); setNewWeeklyFreq(2); }}
                  className="px-4 py-2.5 border border-border rounded-xl text-text-dim hover:bg-bg-hover transition-colors"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddWeekly(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-border rounded-xl text-text-dim hover:text-text-secondary hover:border-accent-green/30 transition-all"
            >
              <span className="text-lg" aria-hidden="true">+</span>
              <span className="text-sm">Add weekly task</span>
            </button>
          )}
        </div>
      )}

      {/* ─── TO-DOS TAB ─────────────────────────────── */}
      {tab === 'todos' && (
        <div role="tabpanel" id="todos-panel" aria-label="To-do tasks" className="space-y-4">
          <p className="text-xs text-text-dim px-1">Tasks that persist until done — set a due date to stay on track</p>

          {/* Add to-do input */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newTodoText}
                onChange={e => setNewTodoText(e.target.value)}
                onKeyDown={handleTodoKeyDown}
                placeholder="Add a to-do..."
                aria-label="New to-do"
                className="flex-1 px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-dim focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
              />
              <button
                onClick={handleAddTodo}
                disabled={!newTodoText.trim()}
                aria-label="Add to-do"
                className="px-4 py-3 bg-accent-green text-bg-primary font-medium rounded-xl hover:bg-accent-green/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >Add</button>
            </div>
            {/* Due date row */}
            <div className="flex items-center gap-2 px-1">
              <label htmlFor="todo-due-date" className="text-xs text-text-dim shrink-0">Due:</label>
              <input
                id="todo-due-date"
                type="date"
                value={newTodoDue}
                onChange={e => setNewTodoDue(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-bg-input border border-border rounded-lg text-sm text-text-secondary focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
              />
              {newTodoDue && (
                <button
                  onClick={() => setNewTodoDue('')}
                  className="text-xs text-text-dim hover:text-text-secondary transition-colors"
                >Clear</button>
              )}
            </div>
          </div>

          {/* To-do list */}
          {todos.length === 0 ? (
            <div className="text-center py-12 text-text-dim">
              <p className="text-lg mb-2" aria-hidden="true">📋</p>
              <p>No to-dos yet. Add one above!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todos.map(task => {
                const overdue = isOverdue(task.dueDate);
                const dueToday = isDueToday(task.dueDate);
                const dueSoon = isDueThisWeek(task.dueDate);
                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                      task.done
                        ? 'bg-bg-card border-border opacity-60'
                        : overdue
                          ? 'bg-bg-card border-red-500/40 hover:border-red-500/60'
                          : dueToday
                            ? 'bg-bg-card border-accent-amber/40 hover:border-accent-amber/60'
                            : dueSoon
                              ? 'bg-bg-card border-accent-blue/30 hover:border-accent-blue/50'
                              : 'bg-bg-card border-border hover:border-accent-green/30'
                    }`}
                  >
                    <button
                      onClick={() => handleToggleTodo(task.id)}
                      aria-label={task.done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`}
                      aria-checked={task.done}
                      role="checkbox"
                      className={`shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                        task.done
                          ? 'bg-accent-green border-accent-green text-bg-primary'
                          : overdue
                            ? 'border-red-500/50 hover:border-red-400'
                            : 'border-border hover:border-accent-green'
                      }`}
                    >
                      {task.done && (
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>

                    <span className={`flex-1 text-sm transition-all ${
                      task.done ? 'text-text-dim line-through' : 'text-text-primary'
                    }`}>
                      {task.text}
                    </span>

                    {/* Due date badge */}
                    {task.dueDate && (
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                        overdue
                          ? 'bg-red-500/20 text-red-400'
                          : dueToday
                            ? 'bg-accent-amber/20 text-accent-amber'
                            : dueSoon
                              ? 'bg-accent-blue/20 text-accent-blue'
                              : 'bg-bg-hover text-text-dim'
                      }`}>
                        {overdue ? 'Overdue' : dueToday ? 'Today' : task.dueDate}
                      </span>
                    )}

                    {confirmDelete === task.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleDeleteTodo(task.id)}
                          className="px-2 py-1 text-xs bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/30 transition-colors"
                        >Delete</button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1 text-xs border border-border rounded-lg text-text-dim hover:bg-bg-hover transition-colors"
                        >Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(task.id)}
                        aria-label={`Delete to-do "${task.text}"`}
                        className="text-text-dim hover:text-red-400 transition-colors shrink-0"
                      >✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── CUSTOM (ONE-OFF) TAB ───────────────────── */}
      {tab === 'custom' && (
        <div role="tabpanel" id="custom-panel" aria-label="Custom one-off tasks" className="space-y-4">
          <p className="text-xs text-text-dim px-1">One-off tasks for today — not repeating</p>

          {/* Add task input */}
          <div className="flex gap-2">
            <input
              ref={customInputRef}
              type="text"
              value={newCustomTask}
              onChange={e => setNewCustomTask(e.target.value)}
              onKeyDown={handleCustomKeyDown}
              placeholder="Add a task for today..."
              aria-label="New task"
              className="flex-1 px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-dim focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
            />
            <button
              onClick={handleAddCustom}
              disabled={!newCustomTask.trim()}
              aria-label="Add task"
              className="px-4 py-3 bg-accent-green text-bg-primary font-medium rounded-xl hover:bg-accent-green/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >Add</button>
          </div>

          {/* Progress bar */}
          {customTasks.length > 0 && (
            <div className="w-full bg-bg-card border border-border rounded-full h-2">
              <div
                className="bg-accent-green h-2 rounded-full transition-all duration-500"
                style={{ width: `${(customTasks.filter(t => t.done).length / customTasks.length) * 100}%` }}
              />
            </div>
          )}

          {/* Task list */}
          {customTasks.length === 0 ? (
            <div className="text-center py-12 text-text-dim">
              <p className="text-lg mb-2" aria-hidden="true">📋</p>
              <p>No custom tasks today. Add one above!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {customTasks.map(task => (
                <div
                  key={task.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    task.done
                      ? 'bg-bg-card border-border opacity-60'
                      : 'bg-bg-card border-border hover:border-accent-green/30'
                  }`}
                >
                  <button
                    onClick={() => handleToggleCustom(task.id)}
                    aria-label={task.done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`}
                    aria-checked={task.done}
                    role="checkbox"
                    className={`shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                      task.done
                        ? 'bg-accent-green border-accent-green text-bg-primary'
                        : 'border-border hover:border-accent-green'
                    }`}
                  >
                    {task.done && (
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  <span className={`flex-1 text-sm transition-all ${
                    task.done ? 'text-text-dim line-through' : 'text-text-primary'
                  }`}>
                    {task.text}
                  </span>

                  {confirmDelete === task.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeleteCustom(task.id)}
                        className="px-2 py-1 text-xs bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/30 transition-colors"
                      >Delete</button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-1 text-xs border border-border rounded-lg text-text-dim hover:bg-bg-hover transition-colors"
                      >Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(task.id)}
                      aria-label={`Delete task "${task.text}"`}
                      className="text-text-dim hover:text-red-400 transition-colors"
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Weekly Checkboxes (individual tick boxes per week instance) ──

function WeeklyCheckboxes({
  templateId,
  onToggle,
  refreshToken,
}: {
  templateId: string;
  onToggle: (task: Task) => void;
  refreshToken: number;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const load = async () => {
      const result = await getWeeklyTaskInstances(templateId);
      setTasks(result.tasks);
    };
    load();
  }, [templateId, refreshToken]); // Re-fetch when refreshToken changes

  if (tasks.length === 0) return null;

  return (
    <div className="flex gap-2 pl-9">
      {tasks.map((task, i) => (
        <button
          key={task.id}
          onClick={() => onToggle(task)}
          aria-label={task.done ? `Mark completion ${i + 1} as not done` : `Mark completion ${i + 1} as done`}
          className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-all text-sm ${
            task.done
              ? 'bg-accent-green border-accent-green text-bg-primary'
              : 'bg-bg-card border-border hover:border-accent-green text-text-dim'
          }`}
        >
          {task.done ? '✓' : '○'}
        </button>
      ))}
    </div>
  );
}

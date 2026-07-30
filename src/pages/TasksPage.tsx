import { useState, useEffect, useRef, useCallback } from 'react';
import { addTask, toggleTask, deleteTask, getTodaysTasks, type Task } from '../db';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadTasks = useCallback(async () => {
    const today = await getTodaysTasks();
    // Sort: open first, then done
    setTasks(today.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.createdAt.localeCompare(b.createdAt);
    }));
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const handleAdd = async () => {
    const text = newTask.trim();
    if (!text) return;
    await addTask(text);
    setNewTask('');
    inputRef.current?.focus();
    await loadTasks();
  };

  const handleToggle = async (id: string) => {
    await toggleTask(id);
    await loadTasks();
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    setConfirmDelete(null);
    await loadTasks();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Today's Tasks</h1>
        <p className="text-sm text-text-muted mt-1">
          {total === 0
            ? 'Add tasks for today — keep them small and specific'
            : `${done}/${total} done${done === total && total > 0 ? ' 🎉' : ''}`
          }
        </p>
      </div>

      {/* Add task input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a task for today..."
          aria-label="New task"
          className="flex-1 px-4 py-3 bg-bg-input border border-border rounded-xl
                     text-text-primary placeholder:text-text-dim
                     focus:border-accent-green focus:ring-1 focus:ring-accent-green
                     transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={!newTask.trim()}
          aria-label="Add task"
          className="px-4 py-3 bg-accent-green text-bg-primary font-medium rounded-xl
                     hover:bg-accent-green/90 transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="w-full bg-bg-card border border-border rounded-full h-2">
          <div
            className="bg-accent-green h-2 rounded-full transition-all duration-500"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <p className="text-lg mb-2">📋</p>
          <p>No tasks yet. Add one above!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <div
              key={task.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                task.done
                  ? 'bg-bg-card border-border opacity-60'
                  : 'bg-bg-card border-border hover:border-accent-green/30'
              }`}
            >
              <button
                onClick={() => handleToggle(task.id)}
                aria-label={task.done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`}
                aria-checked={task.done}
                role="checkbox"
                className={`shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center
                           transition-all ${
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

              <span
                className={`flex-1 text-sm transition-all ${
                  task.done
                    ? 'text-text-dim line-through'
                    : 'text-text-primary'
                }`}
              >
                {task.text}
              </span>

              {confirmDelete === task.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="px-2 py-1 text-xs bg-red-500/20 border border-red-500/30
                               rounded-lg text-red-400 hover:bg-red-500/30 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-2 py-1 text-xs border border-border rounded-lg
                               text-text-dim hover:bg-bg-hover transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(task.id)}
                  aria-label={`Delete task "${task.text}"`}
                  className="text-text-dim hover:text-red-400 transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

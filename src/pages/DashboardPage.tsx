import { useState, useEffect } from 'react';
import { getRecentEntries, calculateStreak, getMoodHistory, getAllRewards, type JournalEntry, type MoodEntry, type Reward } from '../db';
import { streamChat } from '../ai/openrouter';
import { getModel, getApiKey } from '../db';

export default function DashboardPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [streak, setStreak] = useState({ current: 0, longest: 0, lastEntryDate: null as string | null });
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [weeklyInsight, setWeeklyInsight] = useState('');
  const [loadingInsight, setLoadingInsight] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [recentEntries, currentStreak, moodHistory, allRewards] = await Promise.all([
      getRecentEntries(20),
      calculateStreak(),
      getMoodHistory(30),
      getAllRewards(),
    ]);
    setEntries(recentEntries);
    setStreak(currentStreak);
    setMoods(moodHistory);
    setRewards(allRewards);
  };

  const generateWeeklyInsight = async () => {
    setLoadingInsight(true);
    try {
      const apiKey = await getApiKey();
      const model = await getModel();
      if (!apiKey || entries.length === 0) return;

      const weekEntries = entries.filter(e => {
        const d = new Date(e.created);
        const now = new Date();
        return (now.getTime() - d.getTime()) < 7 * 86400000;
      });

      if (weekEntries.length === 0) {
        setWeeklyInsight('No entries this week yet. Start journaling to get insights!');
        return;
      }

      const context = weekEntries
        .map(e => `[${e.created.split('T')[0]}] ${e.body.substring(0, 300)}`)
        .join('\n\n');

      const messages = [
        { role: 'system' as const, content: 'You are an ADHD journal analyst. Provide a brief weekly insight (3-4 sentences) based on the user\'s journal entries. Focus on themes, emotional patterns, and one actionable observation. Be warm and direct.' },
        { role: 'user' as const, content: `Here are my entries from this week:\n\n${context}` },
      ];

      let result = '';
      for await (const chunk of streamChat(messages, { apiKey, model })) {
        result += chunk;
        setWeeklyInsight(result);
      }
    } catch {
      setWeeklyInsight('Could not generate insight. Try again later.');
    } finally {
      setLoadingInsight(false);
    }
  };

  // Mood chart data
  const moodCounts = [0, 0, 0, 0, 0];
  moods.forEach(m => { moodCounts[m.mood - 1]++; });
  const maxMoodCount = Math.max(...moodCounts, 1);

  const moodLabels = ['😞', '😐', '🙂', '😊', '🤩'];
  const moodColors = ['bg-mood-1', 'bg-mood-2', 'bg-mood-3', 'bg-mood-4', 'bg-mood-5'];

  // Stats
  const totalEntries = entries.length;
  const totalWords = entries.reduce((sum, e) => sum + e.wordCount, 0);
  const thisWeek = entries.filter(e => {
    const d = new Date(e.created);
    const now = new Date();
    return (now.getTime() - d.getTime()) < 7 * 86400000;
  }).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-muted mt-1">Your journaling at a glance</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-accent-green">{streak.current}</div>
          <div className="text-xs text-text-muted mt-1">Day streak</div>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-accent-amber">{totalEntries}</div>
          <div className="text-xs text-text-muted mt-1">Total entries</div>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-accent-blue">{totalWords.toLocaleString()}</div>
          <div className="text-xs text-text-muted mt-1">Words written</div>
        </div>
      </div>

      {/* Mood chart */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-medium text-text-secondary mb-4">Mood distribution (30 days)</h3>
        <div className="flex items-end gap-3 h-32">
          {moodCounts.map((count, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-text-dim">{count || ''}</span>
              <div
                className={`w-full rounded-t-lg transition-all duration-500 ${moodColors[i]}`}
                style={{ height: `${(count / maxMoodCount) * 100}%`, minHeight: count > 0 ? '8px' : '2px', opacity: count > 0 ? 1 : 0.2 }}
              />
              <span className="text-lg">{moodLabels[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Weekly insight */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-accent-purple">✨ Weekly insight</h3>
          <button
            onClick={generateWeeklyInsight}
            disabled={loadingInsight}
            className="text-xs text-accent-purple hover:text-accent-purple/80 transition-colors
                       disabled:opacity-40"
          >
            {loadingInsight ? 'Generating...' : 'Generate'}
          </button>
        </div>
        {weeklyInsight ? (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{weeklyInsight}</p>
        ) : (
          <p className="text-sm text-text-dim italic">
            {thisWeek > 0
              ? `You've written ${thisWeek} ${thisWeek === 1 ? 'entry' : 'entries'} this week. Click "Generate" for an AI insight.`
              : 'No entries this week yet. Start journaling to unlock insights!'
            }
          </p>
        )}
      </div>

      {/* Rewards */}
      {rewards.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-medium text-text-secondary mb-3">🏆 Achievements</h3>
          <div className="flex flex-wrap gap-2">
            {rewards.map(r => (
              <div key={r.id} className="px-3 py-2 bg-accent-green-dim rounded-lg">
                <span className="text-sm">{r.label}</span>
                <span className="text-xs text-text-dim ml-2">{r.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent entries */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-muted">Recent entries</h3>
        {entries.length === 0 ? (
          <div className="text-center py-8 text-text-dim">
            <p>No entries yet. Start journaling!</p>
          </div>
        ) : (
          entries.slice(0, 5).map(entry => (
            <div key={entry.id} className="bg-bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-dim">
                  {new Date(entry.created).toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-dim">{entry.wordCount} words</span>
                  {entry.mood && (
                    <span className="text-lg">{['😞', '😐', '🙂', '😊', '🤩'][entry.mood - 1]}</span>
                  )}
                </div>
              </div>
              <p className="text-sm text-text-secondary line-clamp-2">{entry.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

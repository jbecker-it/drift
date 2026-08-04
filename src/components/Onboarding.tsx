import { useState, useEffect, useRef } from 'react';
import {
  setSetting, setBackgroundModel,
  checkOldDatabase, readOldDatabase, importFromJson,
} from '../db';
import { saveNotificationSettings, requestPermission, initNotifications } from '../notifications';
import {
  saveSyncConfig, testConnection, pullFromServerSafe,
  fetchForRestore, type SyncConfig,
} from '../sync/webdavSync';

const PERSONALITIES = [
  { id: 'coach', label: 'Coach', desc: 'Encouraging, pushes you gently, helps you prioritize', icon: '🏆' },
  { id: 'listener', label: 'Listener', desc: 'Calm, patient, just holds space for your thoughts', icon: '👂' },
  { id: 'challenger', label: 'Challenger', desc: 'Direct, questions your assumptions, keeps you honest', icon: '🥊' },
] as const;

/** Trigger a browser download for a JSON string. */
function downloadJson(data: string, filename: string) {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [personality, setPersonality] = useState<string>('coach');
  const [saving, setSaving] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifMorning, setNotifMorning] = useState('08:00');
  const [notifEvening, setNotifEvening] = useState('20:00');
  const [notifTask, setNotifTask] = useState('18:00');
  const [syncUrl, setSyncUrl] = useState('');
  const [syncUser, setSyncUser] = useState('');
  const [syncPass, setSyncPass] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ─── Restore state ─────────────────────────────────
  const [oldDbInfo, setOldDbInfo] = useState<{
    hasData: boolean; entryCount: number; tableCounts: Record<string, number>;
  } | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'none' | 'old-db' | 'upload' | 'webdav'>('none');
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null);
  const [restoreWebdavUrl, setRestoreWebdavUrl] = useState('');
  const [restoreWebdavUser, setRestoreWebdavUser] = useState('');
  const [restoreWebdavPass, setRestoreWebdavPass] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check for old 'drift' database on mount
  useEffect(() => {
    checkOldDatabase()
      .then(info => setOldDbInfo(info))
      .catch(() => setOldDbInfo({ hasData: false, entryCount: 0, tableCounts: {} }));
  }, []);

  // ─── Restore handlers ──────────────────────────────

  const handleOldDbRestore = async () => {
    setRestoreLoading(true);
    setRestoreMode('old-db');
    setRestoreResult(null);
    try {
      const data = await readOldDatabase();
      if (!data) {
        setRestoreResult({ success: false, message: 'No data found in old database.' });
        return;
      }

      // Auto-download backup before importing
      const backup = JSON.stringify({
        ...data,
        backedUpAt: new Date().toISOString(),
        source: 'old-drift-database',
      }, null, 2);
      downloadJson(backup, `drift-old-db-backup-${new Date().toISOString().split('T')[0]}.json`);

      const result = await importFromJson(JSON.stringify(data));
      if (!result.success) {
        setRestoreResult({ success: false, message: result.error || 'Import failed.' });
        return;
      }

      const summary = formatImportSummary(result.imported, result.tombstonesApplied);
      setRestoreResult({
        success: true,
        message: `Restored ${summary}. A backup was downloaded.`,
      });
    } catch (err) {
      setRestoreResult({
        success: false,
        message: err instanceof Error ? err.message : 'Restore from old database failed.',
      });
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setRestoreLoading(true);
    setRestoreMode('upload');
    setRestoreResult(null);
    try {
      const text = await file.text();
      const result = await importFromJson(text);
      if (!result.success) {
        setRestoreResult({ success: false, message: result.error || 'Import failed.' });
        return;
      }

      const summary = formatImportSummary(result.imported);
      setRestoreResult({
        success: true,
        message: `Imported ${summary} from ${file.name}.`,
      });
    } catch (err) {
      setRestoreResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to read file.',
      });
    } finally {
      setRestoreLoading(false);
      e.target.value = '';
    }
  };

  const handleWebdavRestore = async () => {
    setRestoreLoading(true);
    setRestoreMode('webdav');
    setRestoreResult(null);
    try {
      const config: SyncConfig = {
        enabled: true,
        serverUrl: restoreWebdavUrl,
        username: restoreWebdavUser || undefined,
        password: restoreWebdavPass || undefined,
      };

      // Test connection first
      const testResult = await testConnection(config);
      if (!testResult.ok) {
        setRestoreResult({
          success: false,
          message: `Connection failed: ${testResult.error || 'unknown error'}`,
        });
        return;
      }

      // Fetch data from server
      const { data, error } = await fetchForRestore(config);
      if (error || !data) {
        setRestoreResult({
          success: false,
          message: error || 'No backup data found on server.',
        });
        return;
      }

      // Import into local DB
      const result = await importFromJson(JSON.stringify(data));
      if (!result.success) {
        setRestoreResult({ success: false, message: result.error || 'Import failed.' });
        return;
      }

      // Save sync config so ongoing sync works after onboarding
      await saveSyncConfig(config);

      const summary = formatImportSummary(result.imported);
      setRestoreResult({
        success: true,
        message: `Restored ${summary} from WebDAV. Sync is now enabled.`,
      });
    } catch (err) {
      setRestoreResult({
        success: false,
        message: err instanceof Error ? err.message : 'WebDAV restore failed.',
      });
    } finally {
      setRestoreLoading(false);
    }
  };

  function formatImportSummary(
    imported?: Record<string, number>,
    tombstonesApplied?: number,
  ): string {
    if (!imported || Object.keys(imported).length === 0) return 'data';
    const parts = Object.entries(imported)
      .map(([table, count]) => `${count} ${table}`)
      .join(', ');
    if (tombstonesApplied && tombstonesApplied > 0) {
      return `${parts} (${tombstonesApplied} deleted record${tombstonesApplied > 1 ? 's' : ''} removed)`;
    }
    return parts;
  }

  // ─── Finish handler ────────────────────────────────

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    const errors: string[] = [];

    try {
      // #21: Check notification permission result — save enabled=false if denied.
      let notifGranted = false;
      if (notifEnabled) {
        try {
          notifGranted = await requestPermission();
        } catch {
          notifGranted = false;
        }
      }

      // #24: Always save notification settings so disabling persists properly.
      const notifEnabledFinal = notifEnabled && notifGranted;

      try {
        await Promise.all([
          setSetting('openrouter_api_key', apiKey),
          setSetting('openrouter_model', 'anthropic/claude-sonnet-5'),
          setBackgroundModel('deepseek/deepseek-v4-flash'),
          setSetting('personality', personality),
          saveNotificationSettings({
            enabled: notifEnabledFinal,
            morningTime: notifMorning,
            eveningTime: notifEvening,
            taskReminderTime: notifTask,
            perSlotTasks: true,
            morningSlotEnd: '12:00',
            middaySlotEnd: '14:00',
            afternoonSlotEnd: '18:00',
            nightSlotEnd: '22:00',
          }),
        ]);
      } catch (err) {
        // #26: Track which section failed.
        errors.push('Failed to save app settings');
        console.error('Drift: failed to save onboarding settings', err);
      }

      // #22: Schedule notifications after saving settings.
      if (notifEnabledFinal) {
        try {
          await initNotifications();
        } catch (err) {
          console.error('Drift: failed to initialize notifications', err);
          errors.push('Notifications saved but could not be scheduled');
        }
      }

      // #23: Initialize sync after saving config — but only if the user
      // entered sync details in the dedicated sync step (step 6).
      // If they already configured sync during restore, skip to avoid double-pulling.
      if (syncUrl) {
        try {
          const syncConfig = { enabled: true, serverUrl: syncUrl, username: syncUser, password: syncPass };
          await saveSyncConfig(syncConfig);
          // Test the connection and do an initial pull.
          const testResult = await testConnection(syncConfig);
          if (testResult.ok) {
            try {
              await pullFromServerSafe();
            } catch {
              errors.push('Sync configured but initial pull failed');
            }
          } else {
            errors.push(`Sync configured but connection failed: ${testResult.error || 'unknown error'}`);
          }
        } catch (err) {
          console.error('Drift: failed to configure sync', err);
          errors.push('Failed to save sync configuration');
        }
      }

      if (errors.length > 0) {
        setError(errors.join('; '));
        // Show errors on the final step — user can acknowledge and continue.
        setSaving(false);
        return;
      }

      onComplete();
    } catch (err) {
      // #26: Unexpected error during onboarding.
      console.error('Drift: unexpected onboarding error', err);
      setError(err instanceof Error ? err.message : 'Setup encountered an unexpected error');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="max-w-md w-full animate-fade-in">

        {/* ── Step 0: Welcome ─────────────────────────── */}
        {step === 0 && (
          <div className="text-center space-y-6">
            <div className="text-6xl mb-4">🌊</div>
            <h1 className="text-3xl font-bold text-text-primary">Welcome to Drift</h1>
            <p className="text-text-secondary leading-relaxed">
              A journal that works with your ADHD brain, not against it.
              Dump your thoughts. Get AI-powered reflections. Build self-awareness.
            </p>
            <p className="text-text-muted text-sm">
              Your journal is stored locally on this device. When you use AI features, entry text is sent to OpenRouter and your chosen model provider.
            </p>
            <button
              onClick={() => setStep(1)}
              className="px-8 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                         hover:bg-accent-green/90 transition-colors"
            >
              Let's go
            </button>
          </div>
        )}

        {/* ── Step 1: Restore Data ────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-text-primary">Restore your data 📦</h2>
              <p className="text-text-secondary mt-2">
                Import journal entries from a previous installation or backup.
              </p>
              <p className="text-xs text-text-muted mt-1">
                You can also start fresh and set up everything from scratch.
              </p>
            </div>

            {/* Option A: Restore from old 'drift' database */}
            {oldDbInfo?.hasData && (
              <div className="bg-bg-card border border-accent-blue/30 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔄</span>
                  <div>
                    <div className="font-medium text-text-primary">Previous version found</div>
                    <div className="text-sm text-text-secondary">
                      {oldDbInfo.entryCount} journal {oldDbInfo.entryCount === 1 ? 'entry' : 'entries'}
                      {oldDbInfo.tableCounts.tasks ? `, ${oldDbInfo.tableCounts.tasks} tasks` : ''}
                      {oldDbInfo.tableCounts.sessions ? `, ${oldDbInfo.tableCounts.sessions} sessions` : ''}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-text-dim">
                  A backup will be downloaded before restoring, so you won't lose anything.
                </p>
                <button
                  onClick={handleOldDbRestore}
                  disabled={restoreLoading}
                  className="w-full px-4 py-2.5 bg-accent-blue/20 border border-accent-blue/30 text-accent-blue
                             rounded-xl text-sm font-medium hover:bg-accent-blue/30 transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {restoreLoading && restoreMode === 'old-db'
                    ? 'Restoring...'
                    : 'Restore from previous version'}
                </button>
              </div>
            )}

            {/* Option B: Upload JSON file */}
            <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📄</span>
                <div>
                  <div className="font-medium text-text-primary">Upload JSON backup</div>
                  <div className="text-sm text-text-secondary">
                    Import from a previously exported backup file
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={restoreLoading}
                className="w-full px-4 py-2.5 bg-bg-input border border-border text-text-secondary
                           rounded-xl text-sm font-medium hover:bg-bg-hover transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {restoreLoading && restoreMode === 'upload'
                  ? 'Importing...'
                  : selectedFileName
                    ? `Choose another file (selected: ${selectedFileName})`
                    : 'Choose JSON file'}
              </button>
            </div>

            {/* Option C: Connect to WebDAV */}
            <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">☁️</span>
                <div>
                  <div className="font-medium text-text-primary">Connect to WebDAV</div>
                  <div className="text-sm text-text-secondary">
                    Pull data from a WebDAV server (Nextcloud, Synology, etc.)
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <input
                  type="url"
                  value={restoreWebdavUrl}
                  onChange={e => setRestoreWebdavUrl(e.target.value)}
                  placeholder="https://nas.example.com/drift-sync/"
                  className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl
                             text-text-primary text-sm placeholder:text-text-dim
                             focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={restoreWebdavUser}
                    onChange={e => setRestoreWebdavUser(e.target.value)}
                    placeholder="Username (optional)"
                    className="px-3 py-2 bg-bg-input border border-border rounded-xl
                               text-text-primary text-sm placeholder:text-text-dim
                               focus:border-accent-green transition-colors"
                  />
                  <input
                    type="password"
                    value={restoreWebdavPass}
                    onChange={e => setRestoreWebdavPass(e.target.value)}
                    placeholder="Password (optional)"
                    className="px-3 py-2 bg-bg-input border border-border rounded-xl
                               text-text-primary text-sm placeholder:text-text-dim
                               focus:border-accent-green transition-colors"
                  />
                </div>
              </div>
              <button
                onClick={handleWebdavRestore}
                disabled={restoreLoading || !restoreWebdavUrl.trim()}
                className="w-full px-4 py-2.5 bg-bg-input border border-border text-text-secondary
                           rounded-xl text-sm font-medium hover:bg-bg-hover transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {restoreLoading && restoreMode === 'webdav'
                  ? 'Connecting...'
                  : 'Connect & Restore'}
              </button>
            </div>

            {/* Restore result */}
            {restoreResult && (
              <div className={`p-3 rounded-xl text-sm ${
                restoreResult.success
                  ? 'bg-accent-green/10 border border-accent-green/30 text-accent-green'
                  : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
              }`}>
                {restoreResult.success ? '✅' : '⚠️'} {restoreResult.message}
              </div>
            )}

            {/* Start fresh */}
            <div className="text-center space-y-2">
              <p className="text-xs text-text-dim">Or</p>
              <button
                onClick={() => setStep(2)}
                className="px-8 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                           hover:bg-accent-green/90 transition-colors"
              >
                Start fresh
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(0)}
                className="px-6 py-3 border border-border text-text-secondary rounded-xl
                           hover:bg-bg-hover transition-colors"
              >
                Back
              </button>
              {restoreResult?.success && (
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                             hover:bg-accent-green/90 transition-colors"
                >
                  Continue
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: API Key ─────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-text-primary">Set up your AI coach</h2>
              <p className="text-text-secondary mt-2">
                Drift needs an OpenRouter API key to power the AI.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-text-secondary">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl
                           text-text-primary placeholder:text-text-dim
                           focus:border-accent-green focus:ring-1 focus:ring-accent-green
                           transition-colors"
              />
              <p className="text-xs text-text-dim">
                Get your key at{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener"
                   className="text-accent-blue hover:underline">
                  openrouter.ai/keys
                </a>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 border border-border text-text-secondary rounded-xl
                           hover:bg-bg-hover transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => { if (apiKey) setStep(3); }}
                disabled={!apiKey}
                className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                           hover:bg-accent-green/90 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Recommended defaults ────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-text-primary">AI models ready</h2>
              <p className="text-text-secondary mt-2">
                We've pre-selected the best models based on extensive testing.
              </p>
            </div>

            {/* Primary model */}
            <div className="bg-bg-card border border-accent-green/30 rounded-xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-accent-green uppercase tracking-wide">Primary model</span>
                <span className="px-2 py-0.5 text-[10px] font-medium bg-accent-green-dim text-accent-green rounded">Recommended</span>
              </div>
              <div className="text-sm font-medium text-text-primary">Claude Sonnet 5</div>
              <div className="text-xs text-text-dim">anthropic/claude-sonnet-5</div>
              <p className="text-xs text-text-muted leading-relaxed">
                Used for AI Coach chat, reflections, and topic suggestions.
                Won a blind five-model comparison for warmth, brevity, and epistemic honesty.
              </p>
            </div>

            {/* Background model */}
            <div className="bg-bg-card border border-border rounded-xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-accent-blue uppercase tracking-wide">Background model</span>
                <span className="px-2 py-0.5 text-[10px] font-medium bg-accent-blue/10 text-accent-blue rounded">Recommended</span>
              </div>
              <div className="text-sm font-medium text-text-primary">DeepSeek V4 Flash</div>
              <div className="text-xs text-text-dim">deepseek/deepseek-v4-flash</div>
              <p className="text-xs text-text-muted leading-relaxed">
                Used for entry tagging and weekly summaries. Runs automatically on save.
                Entry text is sent to OpenRouter for processing.
              </p>
            </div>

            <p className="text-xs text-text-dim text-center">
              You can change both models anytime in Settings.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-3 border border-border text-text-secondary rounded-xl
                           hover:bg-bg-hover transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                           hover:bg-accent-green/90 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Personality ─────────────────────── */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-text-primary">Choose your vibe</h2>
              <p className="text-text-secondary mt-2">
                How should your AI coach talk to you?
              </p>
            </div>

            <div className="space-y-3">
              {PERSONALITIES.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPersonality(p.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    personality === p.id
                      ? 'border-accent-green bg-accent-green-dim'
                      : 'border-border bg-bg-card hover:bg-bg-hover'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{p.icon}</span>
                    <div>
                      <div className="font-medium text-text-primary">{p.label}</div>
                      <div className="text-sm text-text-secondary">{p.desc}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-3 border border-border text-text-secondary rounded-xl
                           hover:bg-bg-hover transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(5)}
                className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                           hover:bg-accent-green/90 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Notifications ───────────────────── */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-text-primary">Stay on track 🔔</h2>
              <p className="text-text-secondary mt-2">
                Get gentle reminders to journal and check your tasks.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-bg-card border border-border rounded-xl">
                <div>
                  <div className="text-sm font-medium text-text-primary">Enable notifications</div>
                  <div className="text-xs text-text-dim">Morning & evening journal reminders</div>
                </div>
                <button
                  onClick={() => setNotifEnabled(!notifEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${notifEnabled ? 'bg-accent-green' : 'bg-bg-hover'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${notifEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {notifEnabled && (
                <div className="space-y-3 pl-1">
                  <div className="flex items-center gap-3">
                    <span className="text-sm w-28 shrink-0">🌅 Morning</span>
                    <input type="time" value={notifMorning} onChange={e => setNotifMorning(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-bg-input border border-border rounded-lg text-sm text-text-secondary" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm w-28 shrink-0">🌙 Evening</span>
                    <input type="time" value={notifEvening} onChange={e => setNotifEvening(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-bg-input border border-border rounded-lg text-sm text-text-secondary" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm w-28 shrink-0">📋 Task check</span>
                    <input type="time" value={notifTask} onChange={e => setNotifTask(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-bg-input border border-border rounded-lg text-sm text-text-secondary" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(4)} className="px-6 py-3 border border-border text-text-secondary rounded-xl hover:bg-bg-hover transition-colors">Back</button>
              <button onClick={() => setStep(6)} className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl hover:bg-accent-green/90 transition-colors">Next</button>
            </div>
          </div>
        )}

        {/* ── Step 6: Cross-Platform Sync (optional) ──── */}
        {step === 6 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-text-primary">Cross-platform sync 🔄</h2>
              <p className="text-text-secondary mt-2">
                Access your journal from any device via WebDAV.
              </p>
              <p className="text-xs text-text-muted mt-2">
                Optional — works with Nextcloud, Synology, ownCloud, or any WebDAV server. You can set this up later in Settings.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-text-secondary">WebDAV server URL</label>
                <input type="url" value={syncUrl} onChange={e => setSyncUrl(e.target.value)}
                  placeholder="https://nas.example.com/drift-sync/"
                  className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-dim focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-text-secondary">Username</label>
                  <input type="text" value={syncUser} onChange={e => setSyncUser(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-dim focus:border-accent-green transition-colors" />
                </div>
                <div>
                  <label className="text-sm text-text-secondary">Password</label>
                  <input type="password" value={syncPass} onChange={e => setSyncPass(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-dim focus:border-accent-green transition-colors" />
                </div>
              </div>
            </div>

            {error && (
              <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                ⚠️ {error}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(5)} className="px-6 py-3 border border-border text-text-secondary rounded-xl hover:bg-bg-hover transition-colors">Back</button>
              <button onClick={handleFinish} disabled={saving}
                className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl hover:bg-accent-green/90 transition-colors disabled:opacity-50">
                {saving ? 'Setting up...' : 'Finish setup'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  getApiKey, getModel, getPersonality, setSetting,
  getBackgroundModel,
  exportAllData, clearAllData,
} from '../db';
import {
  fetchModels, filterModels, isFree, getFreeOnlySetting, setFreeOnlySetting,
  type OpenRouterModel,
} from '../ai/models';
import {
  notificationsSupported, getPermission, requestPermission,
  getNotificationSettings, saveNotificationSettings, scheduleNotifications,
  type NotificationSettings,
} from '../notifications';
import {
  getSyncConfig, saveSyncConfig, testConnection, performSync,
  getLastSyncTime,
  type SyncConfig,
} from '../sync/webdavSync';
import { checkForUpdates, getCurrentVersion, type UpdateInfo } from '../utils/versionCheck';

const PERSONALITIES = [
  { id: 'coach', label: 'Coach', icon: '🏆' },
  { id: 'listener', label: 'Listener', icon: '👂' },
  { id: 'challenger', label: 'Challenger', icon: '🥊' },
];

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('anthropic/claude-sonnet-5');
  const [bgModel, setBgModel] = useState('deepseek/deepseek-v4-flash');
  const [bgModelSame, setBgModelSame] = useState(false);
  const [personality, setPersonality] = useState('coach');
  const [freeOnly, setFreeOnly] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // ─── Update check state ───────────────────────────
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const info = await checkForUpdates(true);
      setUpdateInfo(info);
      setUpdateChecked(true);
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Notification settings
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>({
    enabled: false,
    morningTime: '08:00',
    eveningTime: '20:00',
    taskReminderTime: '18:00',
    perSlotTasks: true,
    morningSlotEnd: '12:00',
    middaySlotEnd: '14:00',
    afternoonSlotEnd: '18:00',
    nightSlotEnd: '22:00',
  });
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');
  // #34: notificationsSupported() is safe here — this is a client-only PWA with no SSR/SSG.
  const notifSupported = notificationsSupported();
  // #28: Sequence number + promise chain to serialize notification saves.
  const notifSeqRef = useRef(0);
  const notifSaveChain = useRef(Promise.resolve());

  // WebDAV sync state
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({ enabled: false, serverUrl: '' });
  const [syncTesting, setSyncTesting] = useState(false);
  const [syncNow, setSyncNow] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  // #32: Track whether the endpoint has been verified via testConnection.
  const [syncVerified, setSyncVerified] = useState(false);
  // #30: Debounce ref for sync config saves to prevent race overwrites.
  const syncSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [allModels, setAllModels] = useState<OpenRouterModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelError, setModelError] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => {
    // #27: Handle loading errors so the page doesn't stay in an incomplete state.
    void loadData().catch(err => {
      setSaveError(err.message || 'Failed to load settings');
    });
    return () => {
      // Cleanup debounce timer on unmount.
      if (syncSaveTimerRef.current) clearTimeout(syncSaveTimerRef.current);
    };
  }, []);

  // Re-check notification permission when page regains focus
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        setNotifPermission(getPermission());
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  async function loadData() {
    const [key, mod, pers, free, bgMod, notifSettings, syncConf, lastSyncTime] = await Promise.all([
      getApiKey(), getModel(), getPersonality(), getFreeOnlySetting(), getBackgroundModel(),
      getNotificationSettings(),
      getSyncConfig(),
      getLastSyncTime(),
    ]);
    if (key) setApiKey(key);
    setModel(mod);
    setPersonality(pers);
    setFreeOnly(free);
    setNotifSettings(notifSettings);
    setNotifPermission(getPermission());
    setSyncConfig(syncConf);
    setLastSync(lastSyncTime);
    // Background model
    const primaryModel = mod;
    if (bgMod === primaryModel || bgMod === 'same') {
      setBgModelSame(true);
      setBgModel(primaryModel);
    } else {
      setBgModel(bgMod);
    }

    // Load models
    setLoadingModels(true);
    try {
      const models = await fetchModels();
      setAllModels(models);
    } catch (err: any) {
      setModelError(err.message || 'Failed to load models');
    } finally {
      setLoadingModels(false);
    }
  }

  const displayModels = useMemo(() => {
    const filtered = filterModels(allModels, freeOnly);
    if (!modelSearch) return filtered;
    const q = modelSearch.toLowerCase();
    return filtered.filter(m =>
      m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [allModels, freeOnly, modelSearch]);

  const freeCount = allModels.filter(isFree).length;

  const handleFreeOnlyToggle = async () => {
    const next = !freeOnly;
    setFreeOnly(next);
    await setFreeOnlySetting(next);
    setModelSearch('');
  };

  const handleRefreshModels = async () => {
    setLoadingModels(true);
    setModelError('');
    try {
      const models = await fetchModels(true);
      setAllModels(models);
    } catch (err: any) {
      setModelError(err.message || 'Failed to refresh');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        setSetting('openrouter_api_key', apiKey),
        setSetting('openrouter_model', model),
        setSetting('openrouter_background_model', bgModelSame ? 'same' : bgModel),
        setSetting('personality', personality),
      ]);
      // Route notification save through the serialized chain
      notifSaveChain.current = notifSaveChain.current.then(() => saveNotificationSettings(notifSettings));
      await notifSaveChain.current;
      await scheduleNotifications();
      setSaved(true);
      setSaveError(null);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleNotifToggle = async () => {
    if (!notifSupported) return;
    const nextEnabled = !notifSettings.enabled;
    if (nextEnabled && notifPermission !== 'granted') {
      try {
        const granted = await requestPermission();
        setNotifPermission(getPermission());
        if (!granted) return;
      } catch { return; }
    }
    const updated = { ...notifSettings, enabled: nextEnabled };
    setNotifSettings(updated);
    // #6/#28: Serialize saves via promise chain — only the latest write schedules notifications.
    const seq = ++notifSeqRef.current;
    notifSaveChain.current = notifSaveChain.current.then(async () => {
      try {
        await saveNotificationSettings(updated);
        if (seq === notifSeqRef.current) {
          await scheduleNotifications();
        }
      } catch (err) {
        if (seq === notifSeqRef.current) {
          setNotifSettings(prev => ({ ...prev, enabled: !nextEnabled }));
          setSaveError(err instanceof Error ? err.message : 'Failed to save notification settings');
        }
      }
    });
  };

  const handleNotifTimeChange = async (
    field: 'morningTime' | 'eveningTime' | 'taskReminderTime',
    value: string,
  ) => {
    const updated = { ...notifSettings, [field]: value };
    setNotifSettings(updated);
    const seq = ++notifSeqRef.current;
    const prevValue = notifSettings[field]; // Capture for rollback
    notifSaveChain.current = notifSaveChain.current.then(async () => {
      try {
        await saveNotificationSettings(updated);
        if (seq === notifSeqRef.current) {
          await scheduleNotifications();
        }
      } catch (err) {
        if (seq === notifSeqRef.current) {
          setNotifSettings(prev => ({ ...prev, [field]: prevValue }));
          setSaveError(err instanceof Error ? err.message : 'Failed to save notification settings');
        }
      }
    });
  };

  const handleExport = async () => {
    const data = await exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drift-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearAllData();
    setConfirmClear(false);
    window.location.reload();
  };

  // #31: Validate URL before testing connection.
  const handleTestConnection = async () => {
    if (!syncConfig.serverUrl || !syncConfig.serverUrl.trim()) {
      setSyncResult({ ok: false, error: 'Please enter a server URL first.' });
      return;
    }
    try {
      setSyncTesting(true);
      setSyncResult(null);
      const result = await testConnection(syncConfig);
      setSyncResult(result);
      // #32: Mark as verified only if the test succeeds.
      if (result.ok) setSyncVerified(true);
    } catch (err) {
      setSyncResult({ ok: false, error: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setSyncTesting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncNow(true);
    setSyncResult(null);
    try {
      const result = await performSync();
      setSyncResult(result.error ? { ok: false, error: result.error } : { ok: true });
      if (result.lastSync) setLastSync(result.lastSync);
    } catch (err) {
      setSyncResult({ ok: false, error: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setSyncNow(false);
    }
  };

  // #30: Debounce sync config saves to prevent race overwrites from rapid field edits.
  const handleSyncConfigChange = (updates: Partial<SyncConfig>) => {
    const newConfig = { ...syncConfig, ...updates };
    setSyncConfig(newConfig);
    setSyncVerified(false);
    if (syncSaveTimerRef.current) clearTimeout(syncSaveTimerRef.current);
    syncSaveTimerRef.current = setTimeout(() => {
      saveSyncConfig(newConfig).catch(err => {
        setSaveError(err instanceof Error ? err.message : 'Failed to save sync config');
      });
    }, 500);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-sm text-text-muted mt-1">Configure Drift</p>
      </div>

      {/* API Key */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-medium text-text-secondary">OpenRouter API Key</h3>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-v1-..."
            className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl
                       text-text-primary placeholder:text-text-dim pr-20
                       focus:border-accent-green focus:ring-1 focus:ring-accent-green
                       transition-colors"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-dim
                       hover:text-text-secondary transition-colors"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-xs text-text-dim">
          Get your key at{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener"
             className="text-accent-blue hover:underline">
            openrouter.ai/keys
          </a>
        </p>
      </div>

      {/* Free / Paid toggle */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-secondary">Model tier</h3>
            <p className="text-xs text-text-dim mt-0.5">
              {freeOnly
                ? `Showing free models only (${freeCount} available)`
                : `Showing all ${allModels.length} models`
              }
            </p>
          </div>
          <button
            onClick={handleFreeOnlyToggle}
            aria-label="Show free models only"
            aria-pressed={freeOnly}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
              freeOnly ? 'bg-accent-green' : 'bg-bg-hover'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
              freeOnly ? 'translate-x-6' : 'translate-x-0'
            }`} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-dim">
          <span className={!freeOnly ? 'text-accent-green font-medium' : ''}>All</span>
          <span>·</span>
          <span className={freeOnly ? 'text-accent-green font-medium' : ''}>Free only</span>
        </div>
      </div>

      {/* Model picker */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-secondary">AI Model</h3>
          <button
            onClick={handleRefreshModels}
            disabled={loadingModels}
            className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors
                       disabled:opacity-40"
          >
            {loadingModels ? 'Loading...' : '↻ Refresh'}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            placeholder="Search models..."
            className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl
                       text-text-primary placeholder:text-text-dim text-sm
                       focus:border-accent-green focus:ring-1 focus:ring-accent-green
                       transition-colors"
          />
          {modelSearch && (
            <button
              onClick={() => setModelSearch('')}
              aria-label="Clear model search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-secondary"
            >
              ✕
            </button>
          )}
        </div>

        {modelError && (
          <p className="text-xs text-red-400">{modelError}</p>
        )}

        {/* Model list */}
        <div className="max-h-[400px] overflow-y-auto space-y-1 border border-border rounded-xl divide-y divide-border">
          {loadingModels ? (
            <div className="p-4 text-center text-text-dim text-sm animate-pulse-gentle">
              Fetching models from OpenRouter...
            </div>
          ) : displayModels.length === 0 ? (
            <div className="p-4 text-center text-text-dim text-sm">
              No models found{modelSearch ? ` for "${modelSearch}"` : ''}.
            </div>
          ) : (
            displayModels.map(m => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  model === m.id
                    ? 'bg-accent-green-dim'
                    : 'hover:bg-bg-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium truncate ${
                        model === m.id ? 'text-accent-green' : 'text-text-primary'
                      }`}>
                        {m.name}
                      </span>
                      {isFree(m) && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-accent-green-dim text-accent-green rounded">
                          FREE
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-text-dim truncate block">{m.id}</span>
                  </div>
                  {model === m.id && (
                    <span className="shrink-0 text-accent-green">✓</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {!loadingModels && displayModels.length > 0 && (
          <p className="text-xs text-text-dim text-center">
            Showing {displayModels.length} of {allModels.length} models
          </p>
        )}
      </div>

      {/* Background Model */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-secondary">Background Model</h3>
            <p className="text-xs text-text-dim mt-0.5">
              Used for entry tagging and summaries (sends entry text to OpenRouter on save)
            </p>
          </div>
          <button
            onClick={() => setBgModelSame(!bgModelSame)}
            aria-label="Use primary model for background tasks"
            aria-pressed={bgModelSame}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
              bgModelSame ? 'bg-accent-green' : 'bg-bg-hover'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
              bgModelSame ? 'translate-x-6' : 'translate-x-0'
            }`} />
          </button>
        </div>
        <p className="text-xs text-text-dim">
          {bgModelSame ? 'Same as primary model' : 'Separate model for background tasks'}
        </p>

        {!bgModelSame && (
          <div className="relative">
            <input
              type="text"
              value={bgModel}
              onChange={(e) => setBgModel(e.target.value)}
              placeholder="deepseek/deepseek-v4-flash"
              className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl
                         text-text-primary placeholder:text-text-dim text-sm
                         focus:border-accent-green focus:ring-1 focus:ring-accent-green
                         transition-colors"
            />
          </div>
        )}
      </div>

      {/* Personality */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-medium text-text-secondary">AI Personality</h3>
        <div className="grid grid-cols-3 gap-2">
          {PERSONALITIES.map(p => (
            <button
              key={p.id}
              onClick={() => setPersonality(p.id)}
              className={`p-3 rounded-xl text-center transition-all ${
                personality === p.id
                  ? 'bg-accent-green-dim border border-accent-green/30'
                  : 'bg-bg-hover border border-transparent hover:border-border'
              }`}
            >
              <span className="text-2xl">{p.icon}</span>
              <div className="text-xs text-text-secondary mt-1">{p.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-secondary">Notifications</h3>
            <p className="text-xs text-text-dim mt-0.5">
              Reminders to journal and check tasks
            </p>
          </div>
          {notifSupported ? (
            <button
              onClick={handleNotifToggle}
              aria-label="Toggle notifications"
              aria-pressed={notifSettings.enabled}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                notifSettings.enabled ? 'bg-accent-green' : 'bg-bg-hover'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                notifSettings.enabled ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          ) : (
            <span className="text-xs text-text-dim">Not supported</span>
          )}
        </div>

        {notifSupported && notifPermission === 'denied' && (
          <p className="text-xs text-red-400">
            Notifications blocked. Enable them in your browser settings.
          </p>
        )}

        {notifSupported && (
          <p className="text-xs text-text-dim bg-bg-hover/60 border border-border rounded-lg px-3 py-2 leading-relaxed">
            ⚠️ Reminders are local to this device and <span className="text-text-secondary font-medium">only fire while Drift is open</span> in your browser. They don't run in the background when the app is closed or the tab is suspended.
          </p>
        )}

        {notifSettings.enabled && (
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <span className="text-sm w-24 shrink-0">🌅 Morning</span>
              <input
                type="time"
                value={notifSettings.morningTime}
                onChange={e => handleNotifTimeChange('morningTime', e.target.value)}
                className="flex-1 px-3 py-1.5 bg-bg-input border border-border rounded-lg text-sm text-text-secondary focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm w-24 shrink-0">🌙 Evening</span>
              <input
                type="time"
                value={notifSettings.eveningTime}
                onChange={e => handleNotifTimeChange('eveningTime', e.target.value)}
                className="flex-1 px-3 py-1.5 bg-bg-input border border-border rounded-lg text-sm text-text-secondary focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm w-24 shrink-0">📋 Tasks</span>
              <input
                type="time"
                value={notifSettings.taskReminderTime}
                onChange={e => handleNotifTimeChange('taskReminderTime', e.target.value)}
                className="flex-1 px-3 py-1.5 bg-bg-input border border-border rounded-lg text-sm text-text-secondary focus:border-accent-green focus:ring-1 focus:ring-accent-green transition-colors"
              />
            </div>
          </div>
        )}
      </div>

      {/* Cross-Platform Sync */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-secondary">Cross-Platform Sync</h3>
            <p className="text-xs text-text-dim mt-0.5">
              Sync journal data via WebDAV (optional)
            </p>
          </div>
          <button
            onClick={() => handleSyncConfigChange({ enabled: !syncConfig.enabled })}
            aria-label="Toggle sync"
            aria-pressed={syncConfig.enabled}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
              syncConfig.enabled ? 'bg-accent-green' : 'bg-bg-hover'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
              syncConfig.enabled ? 'translate-x-6' : 'translate-x-0'
            }`} />
          </button>
        </div>
        <p className="text-xs text-text-dim">
          Works with Nextcloud, Synology, ownCloud, or any WebDAV server.
          Data is always stored locally first — sync is optional.
        </p>

        {syncConfig.enabled && (
          <div className="space-y-3 pt-2 border-t border-border">
            {/* #32: Show unverified status when sync is configured but not yet tested. */}
            {syncConfig.enabled && !syncVerified && syncResult?.ok !== true && (
              <p className="text-xs text-yellow-400">
                ⚠️ Sync is configured but unverified — test the connection before syncing.
              </p>
            )}
            <div>
              <label className="text-sm text-text-secondary">Server URL</label>
              <input
                type="url"
                value={syncConfig.serverUrl}
                onChange={e => handleSyncConfigChange({ serverUrl: e.target.value })}
                placeholder="https://nas.example.com/drift-sync/"
                className="w-full px-4 py-2.5 mt-1 bg-bg-input border border-border rounded-xl
                           text-text-primary text-sm placeholder:text-text-dim
                           focus:border-accent-green focus:ring-1 focus:ring-accent-green
                           transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-text-secondary">Username</label>
                <input
                  type="text"
                  value={syncConfig.username || ''}
                  onChange={e => handleSyncConfigChange({ username: e.target.value })}
                  placeholder="Optional"
                  className="w-full px-4 py-2.5 mt-1 bg-bg-input border border-border rounded-xl
                             text-text-primary text-sm placeholder:text-text-dim
                             focus:border-accent-green focus:ring-1 focus:ring-accent-green
                             transition-colors"
                />
              </div>
              <div>
                <label className="text-sm text-text-secondary">Password</label>
                <input
                  type="password"
                  value={syncConfig.password || ''}
                  onChange={e => handleSyncConfigChange({ password: e.target.value })}
                  placeholder="Optional"
                  className="w-full px-4 py-2.5 mt-1 bg-bg-input border border-border rounded-xl
                             text-text-primary text-sm placeholder:text-text-dim
                             focus:border-accent-green focus:ring-1 focus:ring-accent-green
                             transition-colors"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleTestConnection}
                disabled={syncTesting || !syncConfig.serverUrl}
                className="px-4 py-2 border border-border rounded-xl text-sm text-text-secondary
                           hover:bg-bg-hover transition-colors disabled:opacity-40"
              >
                {syncTesting ? '⏳ Testing...' : '🔌 Test connection'}
              </button>
              <button
                onClick={handleSyncNow}
                disabled={syncNow || !syncConfig.serverUrl}
                className="px-4 py-2 bg-accent-green text-bg-primary rounded-xl text-sm font-medium
                           hover:bg-accent-green/90 transition-colors disabled:opacity-40"
              >
                {syncNow ? '⏳ Syncing...' : '🔄 Sync now'}
              </button>
            </div>

            {syncResult && (
              <p className={`text-xs ${syncResult.ok ? 'text-accent-green' : 'text-red-400'}`}>
                {syncResult.ok ? '✓ Connection successful' : `✗ ${syncResult.error}`}
              </p>
            )}

            {lastSync && (
              <p className="text-xs text-text-dim">
                Last sync: {new Date(lastSync).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Save */}
      {saveError && (
        <p className="text-sm text-red-400 text-center">{saveError}</p>
      )}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                   hover:bg-accent-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? 'Saving...' : saved ? '✓ Saved!' : 'Save settings'}
      </button>

      {/* Updates */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-text-secondary">Updates</h3>
        <p className="text-xs text-text-dim">Current version: v{getCurrentVersion()}</p>
        <button
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
          className="w-full py-2.5 border border-border rounded-xl text-sm text-text-secondary
                     hover:bg-bg-hover transition-colors disabled:opacity-40"
        >
          {checkingUpdate ? '🔄 Checking...' : '🔄 Check for updates'}
        </button>
        {updateChecked && updateInfo && (
          <div className={updateInfo.available
            ? 'p-3 rounded-lg bg-accent-green/10 border border-accent-green/30 text-sm text-accent-green'
            : 'p-3 rounded-lg bg-bg-hover border border-border text-sm text-text-muted'
          }>
            {updateInfo.available
              ? `✓ v${updateInfo.latestVersion} is available! Check the banner at the bottom to update.`
              : `✓ You're up to date (v${updateInfo.currentVersion})`
            }
          </div>
        )}
        {updateChecked && !updateInfo && (
          <div className="p-3 rounded-lg bg-bg-hover border border-border text-sm text-text-muted">
            Could not check for updates. Try again later.
          </div>
        )}
      </div>

      {/* Data management */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-text-secondary">Data</h3>
        <button
          onClick={handleExport}
          className="w-full py-2.5 border border-border rounded-xl text-sm text-text-secondary
                     hover:bg-bg-hover transition-colors"
        >
          📦 Export all data as JSON
        </button>
        <button
          onClick={handleClear}
          className="w-full py-2.5 border border-red-500/30 rounded-xl text-sm text-red-400
                     hover:bg-red-500/10 transition-colors"
        >
          {confirmClear ? '⚠️ Click again to confirm deletion' : '🗑️ Clear all data'}
        </button>
      </div>
    </div>
  );
}

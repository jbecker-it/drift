import { useState, useEffect, useMemo } from 'react';
import {
  getApiKey, getModel, getPersonality, setSetting,
  getBackgroundModel,
  exportAllData, clearAllData,
} from '../db';
import {
  fetchModels, filterModels, isFree, getFreeOnlySetting, setFreeOnlySetting,
  type OpenRouterModel,
} from '../ai/models';

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
  const [showKey, setShowKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [allModels, setAllModels] = useState<OpenRouterModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelError, setModelError] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const [key, mod, pers, free, bgMod] = await Promise.all([
      getApiKey(), getModel(), getPersonality(), getFreeOnlySetting(), getBackgroundModel(),
    ]);
    if (key) setApiKey(key);
    setModel(mod);
    setPersonality(pers);
    setFreeOnly(free);
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
  };

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
    await Promise.all([
      setSetting('openrouter_api_key', apiKey),
      setSetting('openrouter_model', model),
      setSetting('openrouter_background_model', bgModelSame ? 'same' : bgModel),
      setSetting('personality', personality),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = async () => {
    const data = await exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drift-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearAllData();
    setConfirmClear(false);
    window.location.reload();
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
              Used for entry tagging and summaries (runs locally on save)
            </p>
          </div>
          <button
            onClick={() => setBgModelSame(!bgModelSame)}
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

      {/* Save */}
      <button
        onClick={handleSave}
        className="w-full py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                   hover:bg-accent-green/90 transition-colors"
      >
        {saved ? '✓ Saved!' : 'Save settings'}
      </button>

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

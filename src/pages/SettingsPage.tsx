import { useState, useEffect } from 'react';
import { getApiKey, getModel, getPersonality, setSetting, exportAllData, clearAllData } from '../db';

const MODELS = [
  { id: 'xiaomi/mimo-v2.5', label: 'MiMo v2.5 (Default)' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
];

const PERSONALITIES = [
  { id: 'coach', label: 'Coach', icon: '🏆' },
  { id: 'listener', label: 'Listener', icon: '👂' },
  { id: 'challenger', label: 'Challenger', icon: '🥊' },
];

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('xiaomi/mimo-v2.5');
  const [personality, setPersonality] = useState('coach');
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [key, mod, pers] = await Promise.all([getApiKey(), getModel(), getPersonality()]);
    if (key) setApiKey(key);
    setModel(mod);
    setPersonality(pers);
  };

  const handleSave = async () => {
    await Promise.all([
      setSetting('openrouter_api_key', apiKey),
      setSetting('openrouter_model', model),
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
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
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

      {/* Model */}
      <div className="bg-bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-medium text-text-secondary">AI Model</h3>
        <div className="space-y-2">
          {MODELS.map(m => (
            <label
              key={m.id}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                model === m.id
                  ? 'bg-accent-green-dim border border-accent-green/30'
                  : 'hover:bg-bg-hover border border-transparent'
              }`}
            >
              <input
                type="radio"
                name="model"
                value={m.id}
                checked={model === m.id}
                onChange={() => setModel(m.id)}
                className="accent-accent-green"
              />
              <span className="text-sm text-text-primary">{m.label}</span>
            </label>
          ))}
        </div>
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

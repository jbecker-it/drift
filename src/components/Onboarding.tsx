import { useState, useEffect, useMemo } from 'react';
import { setSetting } from '../db';
import { fetchModels, filterModels, isFree, setFreeOnlySetting, type OpenRouterModel } from '../ai/models';

const PERSONALITIES = [
  { id: 'coach', label: 'Coach', desc: 'Encouraging, pushes you gently, helps you prioritize', icon: '🏆' },
  { id: 'listener', label: 'Listener', desc: 'Calm, patient, just holds space for your thoughts', icon: '👂' },
  { id: 'challenger', label: 'Challenger', desc: 'Direct, questions your assumptions, keeps you honest', icon: '🥊' },
] as const;

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [personality, setPersonality] = useState<string>('coach');
  const [freeOnly, setFreeOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  // Model fetching
  const [allModels, setAllModels] = useState<OpenRouterModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedModel, setSelectedModel] = useState('xiaomi/mimo-v2.5');
  const [modelSearch, setModelSearch] = useState('');

  const displayModels = useMemo(() => {
    const filtered = filterModels(allModels, freeOnly);
    if (!modelSearch) return filtered;
    const q = modelSearch.toLowerCase();
    return filtered.filter(m =>
      m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [allModels, freeOnly, modelSearch]);

  const freeCount = allModels.filter(isFree).length;

  // Fetch models when API key is provided
  const fetchAndSetModels = async () => {
    setLoadingModels(true);
    try {
      const models = await fetchModels();
      setAllModels(models);
    } catch {
      // Silently fail — user can still type a model ID manually
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (apiKey && step === 2) {
      fetchAndSetModels();
    }
  }, [step]);

  const handleFinish = async () => {
    setSaving(true);
    await Promise.all([
      setSetting('openrouter_api_key', apiKey),
      setSetting('openrouter_model', selectedModel),
      setSetting('personality', personality),
      setFreeOnlySetting(freeOnly),
    ]);
    onComplete();
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="max-w-md w-full animate-fade-in">

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="text-center space-y-6">
            <div className="text-6xl mb-4">🌊</div>
            <h1 className="text-3xl font-bold text-text-primary">Welcome to Drift</h1>
            <p className="text-text-secondary leading-relaxed">
              A journal that works with your ADHD brain, not against it.
              Dump your thoughts. Get AI-powered reflections. Build self-awareness.
            </p>
            <p className="text-text-muted text-sm">
              All your data stays on this device. The AI uses OpenRouter.
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

        {/* Step 1: API Key */}
        {step === 1 && (
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
                onClick={() => setStep(0)}
                className="px-6 py-3 border border-border text-text-secondary rounded-xl
                           hover:bg-bg-hover transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => { if (apiKey) setStep(2); }}
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

        {/* Step 2: Free vs Paid + Model */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-text-primary">Choose your model</h2>
              <p className="text-text-secondary mt-2">
                Pick an AI model. Free models work great for journaling.
              </p>
            </div>

            {/* Free/Paid toggle */}
            <div className="bg-bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-text-primary">Free models only</span>
                  <p className="text-xs text-text-dim mt-0.5">
                    {freeOnly
                      ? `${freeCount} free models available`
                      : `All ${allModels.length} models (including ${freeCount} free)`
                    }
                  </p>
                </div>
                <button
                  onClick={() => { setFreeOnly(!freeOnly); setModelSearch(''); }}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                    freeOnly ? 'bg-accent-green' : 'bg-bg-hover'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    freeOnly ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>
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

            {/* Model list */}
            <div className="max-h-[300px] overflow-y-auto space-y-1 border border-border rounded-xl divide-y divide-border">
              {loadingModels ? (
                <div className="p-4 text-center text-text-dim text-sm animate-pulse-gentle">
                  Fetching models...
                </div>
              ) : displayModels.length === 0 ? (
                <div className="p-4 text-center text-text-dim text-sm">
                  No models found
                </div>
              ) : (
                displayModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModel(m.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedModel === m.id
                        ? 'bg-accent-green-dim'
                        : 'hover:bg-bg-hover'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium truncate ${
                            selectedModel === m.id ? 'text-accent-green' : 'text-text-primary'
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
                      {selectedModel === m.id && (
                        <span className="shrink-0 text-accent-green">✓</span>
                      )}
                    </div>
                  </button>
                ))
              )}
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
                onClick={() => setStep(3)}
                className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                           hover:bg-accent-green/90 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Personality */}
        {step === 3 && (
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
                onClick={() => setStep(2)}
                className="px-6 py-3 border border-border text-text-secondary rounded-xl
                           hover:bg-bg-hover transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleFinish}
                disabled={saving}
                className="flex-1 px-6 py-3 bg-accent-green text-bg-primary font-semibold rounded-xl
                           hover:bg-accent-green/90 transition-colors
                           disabled:opacity-40"
              >
                {saving ? 'Setting up...' : "Let's journal! 🌊"}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

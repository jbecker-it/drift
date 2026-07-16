import { useState } from 'react';
import { setSetting } from '../db';

const PERSONALITIES = [
  { id: 'coach', label: 'Coach', desc: 'Encouraging, pushes you gently, helps you prioritize', icon: '🏆' },
  { id: 'listener', label: 'Listener', desc: 'Calm, patient, just holds space for your thoughts', icon: '👂' },
  { id: 'challenger', label: 'Challenger', desc: 'Direct, questions your assumptions, keeps you honest', icon: '🥊' },
] as const;

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [personality, setPersonality] = useState<string>('coach');
  const [saving, setSaving] = useState(false);

  const handleFinish = async () => {
    setSaving(true);
    await setSetting('openrouter_api_key', apiKey);
    await setSetting('openrouter_model', 'xiaomi/mimo-v2.5');
    await setSetting('personality', personality);
    onComplete();
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="max-w-md w-full animate-fade-in">
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
                onClick={() => apiKey && setStep(2)}
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

        {step === 2 && (
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
                onClick={() => setStep(1)}
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

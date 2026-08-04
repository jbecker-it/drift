import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import JournalPage from './pages/JournalPage';
import EntriesPage from './pages/EntriesPage';
import TasksPage from './pages/TasksPage';
import CoachPage from './pages/CoachPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import Onboarding from './components/Onboarding';
import { getApiKey } from './db';
import { initNotifications } from './notifications';
import { isSyncEnabled, pullFromServerSafe } from './sync/webdavSync';

function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);

  const links = [
    { to: '/', label: 'Journal', icon: '📝' },
    { to: '/tasks', label: 'Tasks', icon: '✅' },
    { to: '/entries', label: 'Entries', icon: '📚' },
    { to: '/coach', label: 'Coach', icon: '🤖' },
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-bg-secondary border-b border-border px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isOpen}
          className="text-text-secondary hover:text-text-primary"
        >
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            {isOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        <span className="text-lg font-semibold text-text-primary">Drift</span>
        <div className="w-6" />
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full z-40
        w-56 bg-bg-secondary border-r border-border
        flex flex-col pt-4 pb-6
        transition-transform duration-200
        lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="px-4 mb-8">
          <h1 className="text-xl font-bold text-accent-green">Drift</h1>
          <p className="text-xs text-text-muted mt-1">Your ADHD journal</p>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 px-2 space-y-1">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => setIsOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                transition-colors duration-150
                ${isActive
                  ? 'bg-accent-green-dim text-accent-green'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }
              `}
            >
              <span className="text-lg" aria-hidden="true">{link.icon}</span>
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 mt-auto">
          <p className="text-xs text-text-dim text-center">v0.5.1</p>
        </div>
      </aside>
    </>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary">
      <Sidebar />
      <main className="lg:ml-56 pt-14 lg:pt-0 min-h-screen">
        <div className="max-w-3xl mx-auto px-4 py-6 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [initError, setInitError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let settled = false;

    const failInit = () => {
      if (disposed || settled) return;
      settled = true;
      setInitError(true);
      setReady(true);
    };

    const timeout = setTimeout(failInit, 15000); // 15s — longer than the 10s sync timeout

    (async () => {
      try {
        const key = await getApiKey();
        if (disposed || settled) return;

        // #36: Use pullFromServerSafe directly to capture conflict info.
        // #35: Complete the initial sync pull before marking ready, with a timeout.
        try {
          if (await isSyncEnabled()) {
            const syncTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Sync pull timed out')), 10000)
            );
            const syncResult = await Promise.race([
              pullFromServerSafe(),
              syncTimeout,
            ]);
            // #36: Log any conflicts discovered during initial pull.
            if (syncResult.conflicts.length > 0) {
              console.warn('Drift: initial sync found conflicts', syncResult.conflicts);
            }
          }
        } catch (err) {
          console.warn('Drift: initial sync pull failed', err);
        }

        if (disposed || settled) return;
        settled = true;
        clearTimeout(timeout);
        setHasApiKey(!!key);
        setReady(true);
        // Initialize notifications after app is ready
        initNotifications().catch(() => {});
      } catch (err) {
        console.error('Drift: failed to load API key', err);
        failInit();
      }
    })();

    return () => { disposed = true; clearTimeout(timeout); };
  }, []);

  // #37: Re-read the API key after onboarding completes to ensure consistency.
  const handleOnboardingComplete = useCallback(async () => {
    try {
      const key = await getApiKey();
      setHasApiKey(!!key);
    } catch {
      setHasApiKey(true);
    }
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-text-muted animate-pulse-gentle">Loading Drift...</div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-text-secondary">Drift had trouble starting up.</p>
          <p className="text-xs text-text-dim">This can happen with a stale service worker or database migration error.</p>
          <div className="flex flex-col gap-2 items-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-accent-green text-bg-primary rounded-xl text-sm font-medium hover:bg-accent-green/90 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={async () => {
                try {
                  if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map(r => r.unregister()));
                  }
                  if ('caches' in window) {
                    const names = await caches.keys();
                    await Promise.all(names.map(n => caches.delete(n)));
                  }
                  const { default: Dexie } = await import('dexie');
                  await Dexie.delete('drift');
                  await Dexie.delete('drift-v2');
                } catch (err) {
                  console.error('Reset failed:', err);
                }
                window.location.reload();
              }}
              className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30 transition-colors"
            >
              Reset local data &amp; reload
            </button>
            <p className="text-[10px] text-text-dim">This deletes all local journal data. Export first if possible.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasApiKey) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<JournalPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/entries" element={<EntriesPage />} />
          <Route path="/coach" element={<CoachPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={
            <div className="text-center py-16">
              <p className="text-2xl mb-2">🔍</p>
              <p className="text-text-secondary mb-4">Page not found</p>
              <a href="/" className="text-accent-green hover:underline text-sm">Go to Journal</a>
            </div>
          } />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

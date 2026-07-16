import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import JournalPage from './pages/JournalPage';
import CoachPage from './pages/CoachPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import Onboarding from './components/Onboarding';
import { getApiKey } from './db';

function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);

  const links = [
    { to: '/', label: 'Journal', icon: '📝' },
    { to: '/coach', label: 'Coach', icon: '🤖' },
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-bg-secondary border-b border-border px-4 py-3 flex items-center justify-between">
        <button onClick={() => setIsOpen(!isOpen)} className="text-text-secondary hover:text-text-primary">
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

        <nav className="flex-1 px-2 space-y-1">
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
              <span className="text-lg">{link.icon}</span>
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 mt-auto">
          <p className="text-xs text-text-dim text-center">v0.1.0</p>
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

  useEffect(() => {
    getApiKey().then(key => {
      setHasApiKey(!!key);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-text-muted animate-pulse-gentle">Loading Drift...</div>
      </div>
    );
  }

  if (!hasApiKey) {
    return <Onboarding onComplete={() => setHasApiKey(true)} />;
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<JournalPage />} />
          <Route path="/coach" element={<CoachPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

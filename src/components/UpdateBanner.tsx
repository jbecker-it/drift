import { useState, useEffect, useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  checkForUpdates,
  dismissUpdate,
  isUpdateDismissed,
  getCurrentVersion,
  type UpdateInfo,
} from '../utils/versionCheck';
import { exportAllData } from '../db';

/**
 * UpdateBanner — checks for new versions via GitHub releases and PWA service worker.
 * Shows a non-intrusive banner when an update is available, with a one-click backup option.
 */
export default function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [updating, setUpdating] = useState(false);

  // PWA service worker registration + update detection
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onOfflineReady() {
      console.log('Drift: offline ready');
    },
    onNeedRefresh() {
      setSwUpdateAvailable(true);
    },
  });

  // Check for SW updates periodically via useEffect (cleanup works here)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Check after 30s on load, then every 60 minutes
    const timeout = setTimeout(() => {
      navigator.serviceWorker.getRegistration()?.then(r => r?.update().catch(() => {}));
    }, 30000);
    const interval = setInterval(() => {
      navigator.serviceWorker.getRegistration()?.then(r => r?.update().catch(() => {}));
    }, 60 * 60 * 1000);
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, []);

  // Check GitHub releases on mount
  useEffect(() => {
    checkForUpdates().then(info => {
      if (info?.available && !isUpdateDismissed(info.latestVersion)) {
        setUpdateInfo(info);
      }
    });
  }, []);

  // Combine both update signals
  const hasUpdate = updateInfo?.available || swUpdateAvailable;
  const latestVersion = updateInfo?.latestVersion || 'new version';

  // Dismiss handler
  const handleDismiss = useCallback(() => {
    if (updateInfo) dismissUpdate(updateInfo.latestVersion);
    setDismissed(true);
  }, [updateInfo]);

  // Backup handler — exports JSON before updating
  const handleBackup = useCallback(async () => {
    setBackingUp(true);
    try {
      const data = await exportAllData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drift-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Backup failed:', err);
    } finally {
      setBackingUp(false);
    }
  }, []);

  // Update handler — triggers SW update + reload
  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    try {
      if (swUpdateAvailable) {
        await updateServiceWorker(true);
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error('Update failed:', err);
      setUpdating(false);
    }
  }, [swUpdateAvailable, updateServiceWorker]);

  if (!hasUpdate || dismissed || updating) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 lg:pl-60">
      <div className="max-w-3xl mx-auto bg-bg-card border border-accent-green/30 rounded-xl p-4 shadow-lg animate-slide-up">
        <div className="flex items-start gap-3">
          <span className="text-xl mt-0.5">🔄</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary">
              Update available
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              Drift v{latestVersion} is ready (you have v{getCurrentVersion()})
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleBackup}
                disabled={backingUp}
                className="px-3 py-1.5 text-xs border border-border rounded-lg
                           text-text-secondary hover:bg-bg-hover transition-colors
                           disabled:opacity-40"
              >
                {backingUp ? 'Backing up...' : '💾 Backup JSON'}
              </button>
              <button
                onClick={handleUpdate}
                className="px-3 py-1.5 text-xs bg-accent-green text-bg-primary font-medium rounded-lg
                           hover:bg-accent-green/90 transition-colors"
              >
                Apply update
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs text-text-dim hover:text-text-secondary
                           transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Close update banner"
            className="text-text-dim hover:text-text-secondary transition-colors shrink-0"
          >✕</button>
        </div>
      </div>
    </div>
  );
}

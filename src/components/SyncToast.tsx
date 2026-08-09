import { useState, useEffect, useRef, useCallback } from 'react';
import { onSyncEvent, type SyncEvent } from '../sync/webdavSync';

/**
 * SyncToast — transient notification bubble shown whenever a WebDAV sync is
 * triggered and completes (success or failure). Works for every sync source:
 * the 5-minute background timer, tab re-focus, mutation-triggered sync, and
 * the manual Settings button. Purely cosmetic; never blocks or alters sync.
 */
type BubbleKind = 'start' | 'success' | 'error';

type BubbleState = {
  kind: BubbleKind;
  message: string;
} | null;

const AUTO_DISMISS_MS = 3500;

export default function SyncToast() {
  const [bubble, setBubble] = useState<BubbleState>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Serialize rapid consecutive events (e.g. start→success) so they don't
  // clobber each other mid-dismiss.
  const pendingEvents = useRef<SyncEvent[]>([]);
  const processing = useRef(false);

  const show = useCallback((msg: string, kind: BubbleKind) => {
    setBubble({ kind, message: msg });
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setBubble(null), AUTO_DISMISS_MS);
  }, []);

  // Drain the pending-event queue one at a time so start→success→error bursts
  // are all surfaced in order (the last one wins visually).
  const drain = useCallback(() => {
    if (processing.current) return;
    processing.current = true;
    const processNext = () => {
      const evt = pendingEvents.current.shift();
      if (!evt) { processing.current = false; return; }
      if (evt.type === 'start') {
        show('Syncing to WebDAV…', 'start');
        setTimeout(processNext, 150); // brief, subtle flash for "started"
      } else if (evt.type === 'success') {
        const conflictNote = evt.conflicts && evt.conflicts > 0
          ? ` · ${evt.conflicts} conflict${evt.conflicts > 1 ? 's' : ''} resolved`
          : '';
        show(`Synced ✓${conflictNote}`, 'success');
        processNext();
      } else {
        show(`Sync failed: ${evt.message}`, 'error');
        processNext();
      }
    };
    requestAnimationFrame(processNext);
  }, [show]);

  useEffect(() => {
    return onSyncEvent(evt => {
      pendingEvents.current.push(evt);
      // Prune to avoid unbounded growth if sync fires very frequently.
      if (pendingEvents.current.length > 20) pendingEvents.current.shift();
      drain();
    });
  }, [drain]);

  if (!bubble) return null;

  const palette =
    bubble.kind === 'success' ? 'border-accent-green/50 text-text-primary'
    : bubble.kind === 'error' ? 'border-red-500/50 text-red-300'
    : 'border-border text-text-secondary';

  const icon =
    bubble.kind === 'success' ? '✅'
    : bubble.kind === 'error' ? '⚠️'
    : '🔄';

  return (
    <div className="fixed bottom-4 right-4 z-[60] pointer-events-none animate-slide-up" role="status" aria-live="polite">
      <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl
        bg-bg-card border shadow-lg text-sm font-medium ${palette}`}>
        <span className={bubble.kind === 'start' ? 'animate-spin' : ''}>{icon}</span>
        <span>{bubble.message}</span>
      </div>
    </div>
  );
}
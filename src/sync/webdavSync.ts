// WebDAV Sync for Drift (Optional, local-first)
// Syncs all data as a single JSON file to/from any WebDAV server.
// Uses fetch with Basic Auth — no external library needed.
//
// SECURITY NOTE: WebDAV credentials are stored in plaintext in IndexedDB.
// This is acceptable for a local-first PWA where the same-origin threat
// model applies. Credentials are excluded from exportAllData() and sync payload.
//
// LIMITATION: pushToServer() does an unconditional PUT. Two devices uploading
// concurrently will race — the last write wins. A proper solution requires
// ETag/If-Match headers which not all WebDAV servers support.

import { db } from '../db';
import { getSetting, setSetting } from '../db';

// ─── Types ──────────────────────────────────────────

export interface SyncConfig {
  enabled: boolean;
  /** WebDAV server URL (e.g. https://nas.example.com:5006/drift-sync/) */
  serverUrl: string;
  /** Optional username for Basic Auth */
  username?: string;
  /** Optional password for Basic Auth */
  password?: string;
}

export interface SyncConflict {
  table: string;
  id: string;
  localTimestamp: string;
  remoteTimestamp: string;
}

export interface Tombstone {
  id: string;
  table: string;
  recordId: string;
  deletedAt: string;
}

export interface SyncStatus {
  lastSync: string | null;
  error: string | null;
  syncing: boolean;
  pushOk: boolean;
  pullOk: boolean;
  conflictCount: number;
  backedUp: boolean;
}

const SYNC_FILE = 'drift-data.json';
// Sensitive keys excluded from export

// Serialize tombstone reads/writes so concurrent deletions can't lose a
// tombstone (read-modify-write is not atomic on the settings key-value store).
let tombstoneQueue: Promise<unknown> = Promise.resolve();

/** Run a function serially with respect to other tombstone mutations. */
function withTombstoneLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tombstoneQueue.then(fn, fn);
  // Keep the queue alive even if the operation rejects.
  tombstoneQueue = run.catch(() => {});
  return run;
}

// ─── Helpers ────────────────────────────────────────

/** Get the correct primary key for a record based on table name.
 *  entryTags uses entryId as its Dexie primary key, not id. */
export function getRecordKey(table: string, record: any): string {
  return table === 'entryTags' ? record.entryId : record.id;
}

/** Produce a user-friendly error message from a WebDAV response. */
function authFailed(response: Response): string {
  if (response.status === 401 || response.status === 403) {
    return `Authentication failed (${response.status}). Check your WebDAV username/password.`;
  }
  return `Server returned ${response.status}`;
}

/** Build auth headers from config. Uses UTF-8-safe base64 encoding.
 *  Does NOT force a Content-Type — callers set it per request method
 *  (PROPFIND should not send application/json, which some servers reject). */
function authHeaders(config: SyncConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.username && config.password) {
    // UTF-8 safe base64 encoding
    const raw = `${config.username}:${config.password}`;
    const encoded = btoa(unescape(encodeURIComponent(raw)));
    headers['Authorization'] = `Basic ${encoded}`;
  }
  return headers;
}

/** JSON content-type header merged on top of auth headers for body-bearing requests. */
function jsonHeaders(config: SyncConfig): Record<string, string> {
  return { ...authHeaders(config), 'Content-Type': 'application/json' };
}

// AbortController-based fetch with timeout so a hung WebDAV server can never
// block the UI / background sync forever.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse and validate a WebDAV server URL.
 * Requires HTTPS except for localhost/127.0.0.1/::1 (local dev).
 * Returns a normalized URL object.
 */
function parseWebDAVUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') {
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (!isLocal) {
      throw new Error('WebDAV sync requires HTTPS. Use https:// for remote servers.');
    }
  }
  url.hash = '';
  // Ensure trailing slash on pathname
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return url;
}

/** Get a comparable timestamp from any record type. */
function getTimestamp(record: any): string {
  // Mutation timestamps FIRST (these indicate when the record was last changed)
  return record.updatedAt
    ?? record.doneAt
    ?? record.ended
    ?? record.lastUpdated
    ?? record.taggedAt
    ?? record.earned
    ?? record.started
    // Creation timestamps as fallback (for records without mutation tracking)
    ?? record.createdAt
    ?? record.created
    ?? '';
}

/** Validate remote JSON structure before merge. Returns true if valid. */
function validateRemotePayload(data: any): data is Record<string, any[]> {
  if (!data || typeof data !== 'object') return false;
  const validTables = ['entries', 'entryTags', 'sessions', 'rewards', 'moods', 'tasks', 'taskTemplates', 'contextMemory', 'tombstones'];
  // Validate tombstones if present
  if (data.tombstones !== undefined) {
    if (!Array.isArray(data.tombstones)) return false;
    for (const ts of data.tombstones) {
      if (!ts || typeof ts !== 'object' || typeof ts.id !== 'string' || typeof ts.table !== 'string' || typeof ts.recordId !== 'string') return false;
    }
  }

  for (const key of Object.keys(data)) {
    if (key === 'exportedAt' || key === 'tombstones') continue;
    if (!validTables.includes(key)) continue;
    if (!Array.isArray(data[key])) return false;
    for (const record of data[key]) {
      if (!record || typeof record !== 'object') return false;
      // Key-aware: entryTags use entryId as their primary key, not `id`.
      if (typeof getRecordKey(key, record) !== 'string') return false;
    }
  }
  return true;
}

// ─── Config ─────────────────────────────────────────

/** Get sync config from settings. */
export async function getSyncConfig(): Promise<SyncConfig> {
  const raw = await getSetting('webdav_sync');
  if (!raw) return { enabled: false, serverUrl: '' };
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : '',
      username: typeof parsed.username === 'string' ? parsed.username : undefined,
      password: typeof parsed.password === 'string' ? parsed.password : undefined,
    };
  } catch {
    return { enabled: false, serverUrl: '' };
  }
}

/** Save sync config to settings. */
export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await setSetting('webdav_sync', JSON.stringify(config));
}

/** Check if sync is enabled and configured. */
export async function isSyncEnabled(): Promise<boolean> {
  const config = await getSyncConfig();
  return config.enabled && !!config.serverUrl;
}

/** Test connection to WebDAV server (PROPFIND). */
export async function testConnection(config: SyncConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const baseUrl = parseWebDAVUrl(config.serverUrl);
    const response = await fetchWithTimeout(baseUrl.toString(), {
      method: 'PROPFIND',
      headers: {
        ...authHeaders(config),
        Depth: '0',
      },
    }, 15000);
    if (response.ok) return { ok: true };
    return { ok: false, error: authFailed(response) };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
}

// ─── Tombstones ─────────────────────────────────────

/** Record a deletion as a tombstone for sync. */
export async function recordDeletion(table: string, recordId: string): Promise<void> {
  await recordDeletions([{ table, recordId }]);
}

/** Record multiple deletions atomically (serialized to avoid read-modify-write races). */
export async function recordDeletions(deletions: { table: string; recordId: string }[]): Promise<void> {
  await withTombstoneLock(async () => {
    const tombstones = await getTombstones();
    const now = new Date().toISOString();
    for (const { table, recordId } of deletions) {
      const tombstone: Tombstone = {
        id: `${table}:${recordId}`,
        table,
        recordId,
        deletedAt: now,
      };
      const existing = tombstones.findIndex(t => t.id === tombstone.id);
      if (existing >= 0) {
        tombstones[existing] = tombstone;
      } else {
        tombstones.push(tombstone);
      }
    }
    await setSetting('sync_tombstones', JSON.stringify(tombstones));
  });
}

/** Get all tombstones. */
export async function getTombstones(): Promise<Tombstone[]> {
  const raw = await getSetting('sync_tombstones');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/** Save tombstones. */
async function saveTombstones(tombstones: Tombstone[]): Promise<void> {
  await setSetting('sync_tombstones', JSON.stringify(tombstones));
}

/** Garbage-collect tombstones older than 30 days. */
export async function gcTombstones(): Promise<void> {
  await withTombstoneLock(async () => {
    const tombstones = await getTombstones();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString();
    const kept = tombstones.filter(t => t.deletedAt > cutoffStr);
    if (kept.length !== tombstones.length) {
      await saveTombstones(kept);
    }
  });
}

// ─── Push ───────────────────────────────────────────

/**
 * Build a sync payload that includes tombstones.
 * exportAllData() excludes tombstones and settings, so we build our own
 * payload for sync to ensure deletions are propagated to other devices.
 */
async function buildSyncPayload(): Promise<string> {
  return JSON.stringify({
    entries: await db.entries.toArray(),
    entryTags: await db.entryTags.toArray(),
    sessions: await db.sessions.toArray(),
    rewards: await db.rewards.toArray(),
    moods: await db.moods.toArray(),
    tasks: await db.tasks.toArray(),
    taskTemplates: await db.taskTemplates.toArray(),
    contextMemory: await db.contextMemory.toArray(),
    tombstones: await getTombstones(),
    exportedAt: new Date().toISOString(),
  });
}

/** Push all local data (including tombstones) to WebDAV server. NOTE: unconditional PUT — last write wins. */
export async function pushToServer(): Promise<void> {
  const config = await getSyncConfig();
  if (!config.enabled || !config.serverUrl) return;

  const baseUrl = parseWebDAVUrl(config.serverUrl);
  const data = await buildSyncPayload();
  const response = await fetchWithTimeout(baseUrl.toString() + SYNC_FILE, {
    method: 'PUT',
    headers: jsonHeaders(config),
    body: data,
  });

  if (!response.ok) throw new Error(`Push failed: ${authFailed(response)}`);
  await setSetting('sync_last_push', new Date().toISOString());
}

// ─── Pull with conflict handling ────────────────────

/**
 * Pull data from WebDAV server and merge into local DB.
 * 3-phase merge: detect conflicts → backup locals → merge.
 * Conflict: when remote record is newer OR same timestamp but different content.
 *
 * Local tombstones are merged with remote tombstones to prevent resurrection:
 * if a record was locally deleted (has a local tombstone), it won't be re-imported
 * from a remote that still has the old version.
 */
export async function pullFromServerSafe(): Promise<{ conflicts: SyncConflict[]; backedUp: boolean }> {
  const config = await getSyncConfig();
  if (!config.enabled || !config.serverUrl) return { conflicts: [], backedUp: false };

  const baseUrl = parseWebDAVUrl(config.serverUrl);
  const response = await fetchWithTimeout(baseUrl.toString() + SYNC_FILE, {
    method: 'GET',
    headers: authHeaders(config),
  });

  if (response.status === 404) return { conflicts: [], backedUp: false };
  if (!response.ok) throw new Error(`Pull failed: ${authFailed(response)}`);

  const remote = await response.json();

  // Validate remote data structure
  if (!validateRemotePayload(remote)) {
    throw new Error('Remote data has invalid structure — aborting merge for safety');
  }

  const tables = ['entries', 'entryTags', 'sessions', 'rewards', 'moods', 'tasks', 'taskTemplates', 'contextMemory'] as const;

  // Phase 1: Detect conflicts
  const conflicts: SyncConflict[] = [];
  const conflictLocals: Record<string, Record<string, any>> = {};

  for (const tableName of tables) {
    const remoteRecords = remote[tableName];
    if (!Array.isArray(remoteRecords)) continue;

    const localTable = db[tableName];
    for (const record of remoteRecords) {
      const key = getRecordKey(tableName, record);
      const local = await localTable.get(key);
      if (local) {
        const localTime = getTimestamp(local);
        const remoteTime = getTimestamp(record);
        const isConflict = remoteTime > localTime
          || (remoteTime === localTime && JSON.stringify(local) !== JSON.stringify(record));

        if (isConflict) {
          conflicts.push({ table: tableName, id: key, localTimestamp: localTime, remoteTimestamp: remoteTime });
          if (!conflictLocals[tableName]) conflictLocals[tableName] = {};
          conflictLocals[tableName][key] = local;
        }
      }
    }
  }

  // Phase 2: Backup conflicting local records
  let backedUp = false;
  if (conflicts.length > 0) {
    const backupData = {
      backedUpAt: new Date().toISOString(),
      conflicts: conflicts.map(c => `${c.table}:${c.id}`),
      records: conflictLocals,
    };
    const backupName = `drift-conflicts-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    try {
      const backupResponse = await fetchWithTimeout(baseUrl.toString() + backupName, {
        method: 'PUT',
        headers: jsonHeaders(config),
        body: JSON.stringify(backupData, null, 2),
      });
      if (backupResponse.ok) {
        backedUp = true;
      }
    } catch {
      // Best effort — don't fail the whole pull if backup fails
    }
  }

  // Phase 3: Merge (transactional). Serialized with the tombstone lock so a
  // concurrent user deletion (recordDeletions) can't interleave reads/writes of
  // the sync_tombstones key and clobber a freshly-written tombstone (which would
  // let a deleted record resurrect on the next pull).
  await withTombstoneLock(() =>
    (db as any).transaction('rw', [db.entries, db.entryTags, db.sessions, db.rewards, db.moods, db.tasks, db.taskTemplates, db.contextMemory, db.settings], async () => {
      const VALID_SYNC_TABLES = ['entries', 'entryTags', 'sessions', 'rewards', 'moods', 'tasks', 'taskTemplates', 'contextMemory'];

      // --- Merge local + remote tombstones to prevent resurrection ---
      const localTombstones = await getTombstones();
      const remoteTombstones: Tombstone[] = (Array.isArray(remote.tombstones) ? remote.tombstones : [])
        .filter((ts: any) => ts && typeof ts.id === 'string' && typeof ts.table === 'string'
          && typeof ts.recordId === 'string' && typeof ts.deletedAt === 'string'
          && VALID_SYNC_TABLES.includes(ts.table));

      // Build a merged tombstone map — newer wins
      const tombstoneMap = new Map<string, Tombstone>();
      for (const ts of localTombstones) {
        tombstoneMap.set(ts.id, ts);
      }
      for (const ts of remoteTombstones) {
        const existing = tombstoneMap.get(ts.id);
        if (!existing || ts.deletedAt > existing.deletedAt) {
          tombstoneMap.set(ts.id, ts);
        }
      }
      const allTombstones = Array.from(tombstoneMap.values());

      // Build effective deleted set from merged tombstones (not just remote)
      const deletedSet = new Set(allTombstones.map((ts: Tombstone) => `${ts.table}:${ts.recordId}`));

      // Apply tombstones (deletions) — only if tombstone is newer than local record
      for (const ts of allTombstones) {
        const localTable = (db as any)[ts.table];
        if (localTable) {
          const localRecord = await localTable.get(ts.recordId);
          if (localRecord && ts.deletedAt > getTimestamp(localRecord)) {
            await localTable.delete(ts.recordId);
          }
        }
      }

      // Merge records
      for (const tableName of tables) {
        const remoteRecords = remote[tableName];
        if (!Array.isArray(remoteRecords)) continue;

        const localTable = db[tableName];
        for (const record of remoteRecords) {
          const key = getRecordKey(tableName, record);
          // Skip if this record was deleted by a merged tombstone
          if (deletedSet.has(`${tableName}:${key}`)) continue;
          const local = await localTable.get(key);
          if (!local) {
            await localTable.put(record);
          } else {
            const localTime = getTimestamp(local);
            const remoteTime = getTimestamp(record);
            // Server wins when: remote newer OR same timestamp but different content
            const shouldUseRemote =
              remoteTime > localTime ||
              (remoteTime === localTime && JSON.stringify(local) !== JSON.stringify(record));
            if (shouldUseRemote) {
              await localTable.put(record);
            }
          }
        }
      }

      // Persist merged tombstones locally so they survive push and are propagated
      if (allTombstones.length > 0) {
        await saveTombstones(allTombstones);
      }
    }),
  );

  await setSetting('sync_last_pull', new Date().toISOString());
  if (conflicts.length > 0) {
    await setSetting('sync_last_conflicts', JSON.stringify(conflicts));
  }

  // Garbage-collect old tombstones
  await gcTombstones();

  return { conflicts, backedUp };
}

/** Backward-compat wrapper. */
export async function pullFromServer(): Promise<void> {
  await pullFromServerSafe();
}

/** Get last sync conflicts. */
export async function getLastConflicts(): Promise<SyncConflict[]> {
  const raw = await getSetting('sync_last_conflicts');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/** Clear recorded conflicts (after user acknowledges them). */
export async function clearConflicts(): Promise<void> {
  await setSetting('sync_last_conflicts', '[]');
}

/** Get last sync timestamp. */
export async function getLastSyncTime(): Promise<string | null> {
  return getSetting('sync_last_sync');
}

// ─── Full sync ──────────────────────────────────────

/**
 * Perform full sync: pull first (to detect conflicts), then push.
 * Pull MUST happen before push to avoid overwriting remote changes.
 * Guarded by a mutex so overlapping calls (debounced, periodic, manual)
 * are coalesced instead of racing two pull-then-push sequences.
 */
let syncInProgress = false;

export async function performSync(): Promise<SyncStatus> {
  const status: SyncStatus = {
    lastSync: null, error: null, syncing: true,
    pushOk: false, pullOk: false, conflictCount: 0, backedUp: false,
  };
  if (syncInProgress) {
    return { ...status, syncing: false, error: 'A sync is already in progress.' };
  }
  syncInProgress = true;
  try {
    // Pull FIRST — detect and handle conflicts before overwriting remote
    const { conflicts, backedUp } = await pullFromServerSafe();
    status.pullOk = true;
    status.conflictCount = conflicts.length;
    status.backedUp = backedUp;

    // Then push (local is now merged with remote, safe to upload)
    await pushToServer();
    status.pushOk = true;

    status.lastSync = new Date().toISOString();
    await setSetting('sync_last_sync', status.lastSync);

    if (conflicts.length > 0) {
      status.error = backedUp
        ? `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} resolved — server version kept, local copies backed up to server`
        : `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} resolved — server version kept; WARNING: backing up local copies FAILED, conflicting local edits were overwritten`;
    }
  } catch (err: any) {
    status.error = err.message || 'Sync failed';
  } finally {
    status.syncing = false;
    syncInProgress = false;
  }
  return status;
}

// ─── Restore from WebDAV ───────────────────────────

/**
 * Fetch data from WebDAV server for restore purposes.
 * Returns the raw JSON payload without merging — the caller decides
 * whether to import it into the local DB.
 */
export async function fetchForRestore(config: SyncConfig): Promise<{
  data: Record<string, any[]> | null;
  error?: string;
}> {
  try {
    const baseUrl = parseWebDAVUrl(config.serverUrl);
    const response = await fetchWithTimeout(baseUrl.toString() + SYNC_FILE, {
      method: 'GET',
      headers: authHeaders(config),
    });

    if (response.status === 404) {
      return { data: null, error: 'No backup found on server' };
    }
    if (!response.ok) {
      return { data: null, error: `Server returned ${response.status}` };
    }

    const data = await response.json();

    if (!validateRemotePayload(data)) {
      return { data: null, error: 'Invalid data format on server' };
    }

    return { data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}

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

import { db, exportAllData } from '../db';
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

// ─── Helpers ────────────────────────────────────────

/** Build auth headers from config. Uses UTF-8-safe base64 encoding. */
function authHeaders(config: SyncConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.username && config.password) {
    // UTF-8 safe base64 encoding
    const raw = `${config.username}:${config.password}`;
    const encoded = btoa(unescape(encodeURIComponent(raw)));
    headers['Authorization'] = `Basic ${encoded}`;
  }
  return headers;
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
      if (!record || typeof record !== 'object' || typeof record.id !== 'string') return false;
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
    const response = await fetch(baseUrl.toString(), {
      method: 'PROPFIND',
      headers: {
        ...authHeaders(config),
        Depth: '0',
      },
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: `Server returned ${response.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
}

// ─── Tombstones ─────────────────────────────────────

/** Record a deletion as a tombstone for sync. */
export async function recordDeletion(table: string, recordId: string): Promise<void> {
  await recordDeletions([{ table, recordId }]);
}

/** Record multiple deletions atomically (avoids read-modify-write race). */
export async function recordDeletions(deletions: { table: string; recordId: string }[]): Promise<void> {
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
  const tombstones = await getTombstones();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString();
  const kept = tombstones.filter(t => t.deletedAt > cutoffStr);
  if (kept.length !== tombstones.length) {
    await saveTombstones(kept);
  }
}

// ─── Push ───────────────────────────────────────────

/** Push all local data to WebDAV server. NOTE: unconditional PUT — last write wins. */
export async function pushToServer(): Promise<void> {
  const config = await getSyncConfig();
  if (!config.enabled || !config.serverUrl) return;

  const baseUrl = parseWebDAVUrl(config.serverUrl);
  const data = await exportAllData();
  const response = await fetch(baseUrl.toString() + SYNC_FILE, {
    method: 'PUT',
    headers: authHeaders(config),
    body: data,
  });

  if (!response.ok) throw new Error(`Push failed: ${response.status}`);
  await setSetting('sync_last_push', new Date().toISOString());
}

// ─── Pull with conflict handling ────────────────────

/**
 * Pull data from WebDAV server and merge into local DB.
 * 3-phase merge: detect conflicts → backup locals → merge.
 * Conflict: when remote record is newer OR same timestamp but different content.
 */
export async function pullFromServerSafe(): Promise<{ conflicts: SyncConflict[]; backedUp: boolean }> {
  const config = await getSyncConfig();
  if (!config.enabled || !config.serverUrl) return { conflicts: [], backedUp: false };

  const baseUrl = parseWebDAVUrl(config.serverUrl);
  const response = await fetch(baseUrl.toString() + SYNC_FILE, {
    method: 'GET',
    headers: authHeaders(config),
  });

  if (response.status === 404) return { conflicts: [], backedUp: false };
  if (!response.ok) throw new Error(`Pull failed: ${response.status}`);

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
      const local = await localTable.get(record.id);
      if (local) {
        const localTime = getTimestamp(local);
        const remoteTime = getTimestamp(record);
        const isConflict = remoteTime > localTime
          || (remoteTime === localTime && JSON.stringify(local) !== JSON.stringify(record));

        if (isConflict) {
          conflicts.push({ table: tableName, id: record.id, localTimestamp: localTime, remoteTimestamp: remoteTime });
          if (!conflictLocals[tableName]) conflictLocals[tableName] = {};
          conflictLocals[tableName][record.id] = local;
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
      const backupResponse = await fetch(baseUrl.toString() + backupName, {
        method: 'PUT',
        headers: authHeaders(config),
        body: JSON.stringify(backupData, null, 2),
      });
      if (backupResponse.ok) {
        backedUp = true;
      }
    } catch {
      // Best effort — don't fail the whole pull if backup fails
    }
  }

  // Phase 3: Merge (transactional)
  await (db as any).transaction('rw', [db.entries, db.entryTags, db.sessions, db.rewards, db.moods, db.tasks, db.taskTemplates, db.contextMemory, db.settings], async () => {
      // Apply remote tombstones (deletions) — only if tombstone is newer than local record
      const VALID_SYNC_TABLES = ['entries', 'entryTags', 'sessions', 'rewards', 'moods', 'tasks', 'taskTemplates', 'contextMemory'];
      const remoteTombstones: Tombstone[] = (Array.isArray(remote.tombstones) ? remote.tombstones : [])
        .filter((ts: any) => ts && typeof ts.id === 'string' && typeof ts.table === 'string'
          && typeof ts.recordId === 'string' && typeof ts.deletedAt === 'string'
          && VALID_SYNC_TABLES.includes(ts.table));
      for (const ts of remoteTombstones) {
        const localTable = (db as any)[ts.table];
        if (localTable) {
          const localRecord = await localTable.get(ts.recordId);
          if (!localRecord || ts.deletedAt > getTimestamp(localRecord)) {
            await localTable.delete(ts.recordId);
          }
        }
      }

      // Build set of tombstone-deleted table:id combos
      const deletedSet = new Set(remoteTombstones.map((ts: Tombstone) => `${ts.table}:${ts.recordId}`));

      // Merge records
      for (const tableName of tables) {
        const remoteRecords = remote[tableName];
        if (!Array.isArray(remoteRecords)) continue;

        const localTable = db[tableName];
        for (const record of remoteRecords) {
          // Skip if this record was deleted by a tombstone
          if (deletedSet.has(`${tableName}:${record.id}`)) continue;
          const local = await localTable.get(record.id);
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
      // Persist remote tombstones locally so they survive push and are propagated
      if (remoteTombstones.length > 0) {
        const localTombstones = await getTombstones();
        const localMap = new Map(localTombstones.map(t => [t.id, t]));
        for (const ts of remoteTombstones) {
          const existing = localMap.get(ts.id);
          if (!existing || ts.deletedAt > existing.deletedAt) {
            localMap.set(ts.id, ts);
          }
        }
        await saveTombstones(Array.from(localMap.values()));
      }
    },
  );

  await setSetting('sync_last_pull', new Date().toISOString());
  if (conflicts.length > 0) {
    await setSetting('sync_last_conflicts', JSON.stringify(conflicts));
  }

  // Apply local tombstones to remote on next push (export includes tombstones now)
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
 */
export async function performSync(): Promise<SyncStatus> {
  const status: SyncStatus = {
    lastSync: null, error: null, syncing: true,
    pushOk: false, pullOk: false, conflictCount: 0, backedUp: false,
  };
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
      status.error = `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} resolved (server version kept, local backed up)`;
    }
  } catch (err: any) {
    status.error = err.message || 'Sync failed';
  } finally {
    status.syncing = false;
  }
  return status;
}

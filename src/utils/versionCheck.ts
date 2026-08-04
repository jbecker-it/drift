/**
 * Version check utility — compares local version against GitHub releases.
 * Uses the GitHub REST API (no auth needed for public repos, 60 req/hour).
 */

const GITHUB_REPO = 'jbecker-it/drift';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  publishedAt: string;
}

/** Parse semver string into comparable tuple. */
function parseSemver(v: string): [number, number, number] {
  const match = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function isNewer(latest: string, current: string): boolean {
  const [a1, a2, a3] = parseSemver(latest);
  const [b1, b2, b3] = parseSemver(current);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

/** Get the current app version from package.json (baked in at build time). */
export function getCurrentVersion(): string {
  // Vite replaces this at build time
  return __APP_VERSION__;
}

declare const __APP_VERSION__: string;

/** Check localStorage for last check timestamp. */
function lastCheckTime(): number {
  try {
    return parseInt(localStorage.getItem('drift_last_version_check') || '0');
  } catch {
    return 0;
  }
}

function setLastCheckTime(ts: number): void {
  try {
    localStorage.setItem('drift_last_version_check', String(ts));
  } catch { /* ignore */ }
}

/** Get the stored update info (avoids re-fetching). */
export function getStoredUpdateInfo(): UpdateInfo | null {
  try {
    const raw = localStorage.getItem('drift_update_info');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function storeUpdateInfo(info: UpdateInfo): void {
  try {
    localStorage.setItem('drift_update_info', JSON.stringify(info));
  } catch { /* ignore */ }
}

/** Dismiss the update notification (marks as seen for this version). */
export function dismissUpdate(latestVersion: string): void {
  try {
    localStorage.setItem('drift_update_dismissed', latestVersion);
  } catch { /* ignore */ }
}

/** Check if the update notification was dismissed for the current latest version. */
export function isUpdateDismissed(latestVersion: string): boolean {
  try {
    return localStorage.getItem('drift_update_dismissed') === latestVersion;
  } catch {
    return false;
  }
}

/**
 * Check GitHub for a newer release.
 * Returns cached result if checked within the last 6 hours.
 * Returns null if the check fails (network, rate limit, etc).
 */
export async function checkForUpdates(force = false): Promise<UpdateInfo | null> {
  const now = Date.now();
  const currentVersion = getCurrentVersion();

  // Return cached result if recent (unless forced)
  if (!force && (now - lastCheckTime()) < CHECK_INTERVAL_MS) {
    const cached = getStoredUpdateInfo();
    if (cached) return cached;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const release = await response.json();
    const tagName: string = release.tag_name || '';
    const latestVersion = tagName.replace(/^v/, '');
    const publishedAt: string = release.published_at || '';

    const info: UpdateInfo = {
      available: isNewer(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      publishedAt,
    };

    // Cache the result
    storeUpdateInfo(info);
    setLastCheckTime(now);

    return info;
  } catch {
    // Network error, rate limit, etc — don't crash
    return null;
  }
}

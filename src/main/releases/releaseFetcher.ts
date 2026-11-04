import { request as httpsRequest } from 'https';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import { getUserDataDir } from '../utils';

// Release Fetch Data Flow:
//   ┌─────────────────────┐
//   │ Dropdown arrow click │
//   └──────────┬──────────┘
//              │ IPC: FetchReleases(releaseHistoryUrl)
//              ▼
//   ┌─────────────────────┐     hit
//   │   Memory cache      │─────────────► return cached list
//   └──────────┬──────────┘
//              │ miss
//              ▼
//   ┌─────────────────────┐     fresh (<1hr)
//   │   Disk cache        │─────────────► load into memory, return
//   └──────────┬──────────┘
//              │ miss/stale
//              ▼
//   ┌─────────────────────┐     success
//   │ raw.githubusercontent│────────────► parse ### dates
//   │    .com/...mdx       │              write to disk + memory
//   └──────────┬──────────┘              return list
//              │ fail
//              ▼
//   ┌─────────────────────┐
//   │ Stale disk cache?   │─yes──► return stale (warn log)
//   └──────────┬──────────┘
//              │ no
//              ▼
//   ┌─────────────────────┐
//   │ YAML defaultVersion │──────► return [defaultVersion]
//   └─────────────────────┘

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

interface ICachedReleases {
  fetchedAt: number;
  versions: string[];
}

// In-memory cache keyed by URL
const memoryCache = new Map<string, ICachedReleases>();

/**
 * Parse version dates from release history markdown.
 * Extracts ### YYYY-MM-DD headings, validates date format.
 */
export function parseReleaseVersions(markdown: string): string[] {
  const versions: string[] = [];
  const dateRegex = /^###\s+(\d{4}-\d{2}-\d{2})\b/gm;
  let match: RegExpExecArray | null;

  while ((match = dateRegex.exec(markdown)) !== null) {
    const dateStr = match[1];
    // Validate it's a real date
    const parsed = new Date(dateStr + 'T00:00:00Z');
    if (!isNaN(parsed.getTime()) && parsed.toISOString().startsWith(dateStr)) {
      versions.push(dateStr);
    }
  }

  return [...new Set(versions)].sort().reverse();
}

function getCacheDir(): string {
  return path.join(getUserDataDir(), 'release-cache');
}

function getCacheFilePath(url: string): string {
  // Create a safe filename from the URL
  const safeName = url.replace(/[^a-zA-Z0-9]/g, '_').slice(-100);
  return path.join(getCacheDir(), `${safeName}.json`);
}

function readDiskCache(url: string): ICachedReleases | null {
  try {
    const cachePath = getCacheFilePath(url);
    if (!fs.existsSync(cachePath)) {
      return null;
    }
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (
      data &&
      typeof data.fetchedAt === 'number' &&
      Array.isArray(data.versions)
    ) {
      return data as ICachedReleases;
    }
    // Corrupt cache file
    log.warn(`Corrupt release cache at ${cachePath}, removing`);
    fs.unlinkSync(cachePath);
    return null;
  } catch (error) {
    log.warn(`Failed to read release cache: ${error}`);
    return null;
  }
}

function writeDiskCache(url: string, cached: ICachedReleases): void {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(getCacheFilePath(url), JSON.stringify(cached), 'utf8');
  } catch (error) {
    log.warn(`Failed to write release cache: ${error}`);
  }
}

function fetchRawMarkdown(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { timeout: FETCH_TIMEOUT_MS }, res => {
      // Handle redirects (raw.githubusercontent.com may 302)
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        fetchRawMarkdown(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }

      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
    req.end();
  });
}

/**
 * Fetch available release versions for a given release history URL.
 * Uses in-memory cache -> disk cache -> network fetch -> fallback chain.
 *
 * @param releaseHistoryUrl - raw.githubusercontent.com URL for the markdown
 * @param defaultVersion - YAML defaultVersion as last-resort fallback
 * @returns Array of version strings (YYYY-MM-DD format), newest first
 */
export async function fetchReleases(
  releaseHistoryUrl: string,
  defaultVersion: string
): Promise<string[]> {
  // 1. Check memory cache
  const memoryCached = memoryCache.get(releaseHistoryUrl);
  if (memoryCached && Date.now() - memoryCached.fetchedAt < CACHE_TTL_MS) {
    log.debug('Release versions served from memory cache');
    return memoryCached.versions;
  }

  // 2. Check disk cache
  const diskCached = readDiskCache(releaseHistoryUrl);
  if (diskCached && Date.now() - diskCached.fetchedAt < CACHE_TTL_MS) {
    log.debug('Release versions served from disk cache');
    memoryCache.set(releaseHistoryUrl, diskCached);
    return diskCached.versions;
  }

  // 3. Fetch from network
  try {
    const markdown = await fetchRawMarkdown(releaseHistoryUrl);
    const versions = parseReleaseVersions(markdown);

    if (versions.length > 0) {
      const cached: ICachedReleases = {
        fetchedAt: Date.now(),
        versions
      };
      memoryCache.set(releaseHistoryUrl, cached);
      writeDiskCache(releaseHistoryUrl, cached);
      log.info(
        `Fetched ${versions.length} release versions from ${releaseHistoryUrl}`
      );
      return versions;
    }

    log.warn('No versions parsed from release history markdown');
  } catch (error) {
    log.warn(`Failed to fetch release history: ${error}`);
  }

  // 4. Serve stale disk cache if available
  if (diskCached) {
    log.warn('Serving stale release cache');
    memoryCache.set(releaseHistoryUrl, diskCached);
    return diskCached.versions;
  }

  // 5. Fallback to YAML defaultVersion
  log.warn(`Falling back to defaultVersion: ${defaultVersion}`);
  return defaultVersion ? [defaultVersion] : [];
}

/**
 * Clear in-memory cache (for testing).
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

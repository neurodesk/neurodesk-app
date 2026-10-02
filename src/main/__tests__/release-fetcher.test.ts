import * as fs from 'fs';
import * as path from 'path';
import {
  parseReleaseVersions,
  fetchReleases,
  clearMemoryCache
} from '../releases/releaseFetcher';

// Mock electron-log
jest.mock('electron-log', () => ({
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  __esModule: true
}));

// Mock electron app.getPath
jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/neurodesk-test-cache';
      if (name === 'home') return '/tmp';
      return '/tmp';
    },
    getName: () => 'neurodesk'
  }
}));

// Mock https
jest.mock('https', () => ({
  request: jest.fn()
}));

const { request: mockRequest } = require('https');

// ── parseReleaseVersions ──

describe('parseReleaseVersions', () => {
  it('extracts YYYY-MM-DD from ### headings', () => {
    const markdown = `
## 2026

<details class="release-item" open>
<summary>

### 2026-07-11

</summary>
#### New Features
- n/a
</details>

<details class="release-item" open>
<summary>

### 2026-06-04

</summary>
#### New Features
- new webapps design
</details>
`;
    const versions = parseReleaseVersions(markdown);
    expect(versions).toEqual(['2026-07-11', '2026-06-04']);
  });

  it('returns empty array for empty input', () => {
    expect(parseReleaseVersions('')).toEqual([]);
  });

  it('returns empty array when no ### headings match', () => {
    const markdown = `
## Release History
This is a release history page.
### Overview
Some overview text.
`;
    expect(parseReleaseVersions(markdown)).toEqual([]);
  });

  it('ignores headings with extra text after the date', () => {
    const markdown = `
### 2026-07-11 <Badge text="Latest" variant="success" />
### 2026-06-04
### Not a date heading
### 2025-12-15
`;
    const versions = parseReleaseVersions(markdown);
    expect(versions).toEqual(['2026-07-11', '2026-06-04', '2025-12-15']);
  });

  it('rejects invalid dates like 2026-13-45', () => {
    const markdown = `
### 2026-13-45
### 2026-02-30
### 2026-01-15
`;
    const versions = parseReleaseVersions(markdown);
    // 2026-13-45 is invalid (month 13), 2026-02-30 is invalid
    // Only 2026-01-15 should pass
    expect(versions).toContain('2026-01-15');
    expect(versions).not.toContain('2026-13-45');
    expect(versions).not.toContain('2026-02-30');
  });

  it('returns the newest unique release first even when headings are unordered', () => {
    const markdown = `
### 2026-07-11
### 2026-09-23
### 2026-07-11
`;
    expect(parseReleaseVersions(markdown)).toEqual([
      '2026-09-23',
      '2026-07-11'
    ]);
  });

  it('does not match ## or #### headings', () => {
    const markdown = `
## 2026-07-11
#### 2026-06-04
### 2026-05-01
`;
    expect(parseReleaseVersions(markdown)).toEqual(['2026-05-01']);
  });

  it('handles markdown with mixed content around headings', () => {
    const markdown = `---
title: Release History
---

import { Badge } from '@astrojs/starlight/components';

**Latest Version:** 2026-07-11

## 2026

<details class="release-item" open>
<summary>

### 2026-07-11 <Badge text="Latest" variant="success" />

</summary>

#### Improvements
- Improved cvmfs setup

</details>

<details class="release-item" open>
<summary>

### 2026-06-04

</summary>

#### New Features
- new webapps design

</details>

## 2025

<details class="release-item">
<summary>

### 2025-12-01

</summary>

#### Bug Fixes
- fixed issue

</details>
`;
    const versions = parseReleaseVersions(markdown);
    expect(versions).toEqual(['2026-07-11', '2026-06-04', '2025-12-01']);
  });
});

// ── fetchReleases ──

describe('fetchReleases', () => {
  const testUrl = 'https://raw.githubusercontent.com/test/test/main/test.mdx';
  const testDefault = '2026-01-01';
  const cacheDir = '/tmp/neurodesk-test-cache/release-cache';

  beforeEach(() => {
    clearMemoryCache();
    // Clean up disk cache
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  function mockHttpResponse(statusCode: number, body: string) {
    const mockRes = {
      statusCode,
      headers: {},
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'data') cb(body);
        if (event === 'end') cb();
        return mockRes;
      })
    };
    const mockReq = {
      on: jest.fn().mockReturnThis(),
      end: jest.fn(),
      destroy: jest.fn()
    };
    mockRequest.mockImplementation(
      (_url: string, _opts: any, callback: Function) => {
        callback(mockRes);
        return mockReq;
      }
    );
    return { mockReq, mockRes };
  }

  function mockHttpError(errorMessage: string) {
    const mockReq = {
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'error') {
          setTimeout(() => cb(new Error(errorMessage)), 0);
        }
        return mockReq;
      }),
      end: jest.fn(),
      destroy: jest.fn()
    };
    mockRequest.mockImplementation(() => mockReq);
    return mockReq;
  }

  it('fetches and parses versions from network', async () => {
    mockHttpResponse(200, '### 2026-07-11\n### 2026-06-04\n');

    const versions = await fetchReleases(testUrl, testDefault);
    expect(versions).toEqual(['2026-07-11', '2026-06-04']);
  });

  it('serves from memory cache on second call', async () => {
    mockHttpResponse(200, '### 2026-07-11\n');

    await fetchReleases(testUrl, testDefault);
    const versions = await fetchReleases(testUrl, testDefault);

    expect(versions).toEqual(['2026-07-11']);
    // Should only have been called once (first fetch)
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('serves from disk cache after memory is cleared', async () => {
    mockHttpResponse(200, '### 2026-07-11\n### 2026-06-04\n');

    await fetchReleases(testUrl, testDefault);
    clearMemoryCache();

    // Should serve from disk without another network call
    const versions = await fetchReleases(testUrl, testDefault);
    expect(versions).toEqual(['2026-07-11', '2026-06-04']);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('falls back to defaultVersion on network error', async () => {
    mockHttpError('Network error');

    const versions = await fetchReleases(testUrl, testDefault);
    expect(versions).toEqual([testDefault]);
  });

  it('falls back to defaultVersion on HTTP error', async () => {
    mockHttpResponse(404, 'Not Found');

    const versions = await fetchReleases(testUrl, testDefault);
    expect(versions).toEqual([testDefault]);
  });

  it('returns empty array when no defaultVersion and network fails', async () => {
    mockHttpError('Network error');

    const versions = await fetchReleases(testUrl, '');
    expect(versions).toEqual([]);
  });

  it('falls back to stale disk cache when network fails', async () => {
    // First: successful fetch to populate disk cache
    mockHttpResponse(200, '### 2026-07-11\n');
    await fetchReleases(testUrl, testDefault);

    // Expire the cache by manipulating the file
    const safeName = testUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-100);
    const cachePath = path.join(cacheDir, `${safeName}.json`);
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    cached.fetchedAt = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    fs.writeFileSync(cachePath, JSON.stringify(cached));

    clearMemoryCache();

    // Now make network fail
    mockHttpError('Network error');

    const versions = await fetchReleases(testUrl, testDefault);
    // Should serve stale cache, not defaultVersion
    expect(versions).toEqual(['2026-07-11']);
  });

  it('handles corrupt disk cache gracefully', async () => {
    // Write corrupt cache
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const safeName = testUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-100);
    const cachePath = path.join(cacheDir, `${safeName}.json`);
    fs.writeFileSync(cachePath, 'not valid json{{{');

    mockHttpResponse(200, '### 2026-07-11\n');

    const versions = await fetchReleases(testUrl, testDefault);
    expect(versions).toEqual(['2026-07-11']);
  });

  it('falls back to defaultVersion when markdown has no dates', async () => {
    mockHttpResponse(200, '# Release History\nNo releases yet.\n');

    const versions = await fetchReleases(testUrl, testDefault);
    expect(versions).toEqual([testDefault]);
  });
});

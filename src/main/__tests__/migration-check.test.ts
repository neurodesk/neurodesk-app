import { fetchMigrationStatus } from '../migrationcheck';

// Mock node-fetch
jest.mock('node-fetch', () => jest.fn());
const mockFetch = require('node-fetch') as jest.Mock;

describe('fetchMigrationStatus', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns shouldNotify=false when status is active', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'active' })
    });

    const result = await fetchMigrationStatus();
    expect(result.shouldNotify).toBe(false);
    expect(result.info?.status).toBe('active');
  });

  it('returns shouldNotify=true when status is migrated', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'migrated',
          message: 'Please update to ScigetApp',
          downloadUrl: 'https://github.com/sciget/scigetapp/releases'
        })
    });

    const result = await fetchMigrationStatus();
    expect(result.shouldNotify).toBe(true);
    expect(result.info?.status).toBe('migrated');
    expect(result.info?.message).toBe('Please update to ScigetApp');
    expect(result.info?.downloadUrl).toBe(
      'https://github.com/sciget/scigetapp/releases'
    );
  });

  it('returns shouldNotify=false on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await fetchMigrationStatus();
    expect(result.shouldNotify).toBe(false);
    expect(result.info).toBeUndefined();
  });

  it('returns shouldNotify=false on malformed JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unexpected: 'data' })
    });

    const result = await fetchMigrationStatus();
    expect(result.shouldNotify).toBe(false);
    expect(result.info).toBeUndefined();
  });

  it('returns shouldNotify=false on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404
    });

    const result = await fetchMigrationStatus();
    expect(result.shouldNotify).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiClientError } from '../api/client';

describe('ApiClient', () => {
  beforeEach(() => {
    api.setToken(null);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores and retrieves token from localStorage', () => {
    api.setToken('test-token');
    expect(api.getToken()).toBe('test-token');
    expect(localStorage.getItem('keel_token')).toBe('test-token');
  });

  it('clears token on setToken(null)', () => {
    api.setToken('test-token');
    api.setToken(null);
    expect(api.getToken()).toBeNull();
  });

  it('reads cached token on getToken()', () => {
    localStorage.setItem('keel_token', 'cached-token');
    // setToken(null) clears localStorage, so don't call it
    // getToken() always reads from localStorage
    expect(api.getToken()).toBe('cached-token');
  });

  it('throws ApiClientError on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }),
    } as Response);

    await expect(api.get('/auth/me')).rejects.toThrow(ApiClientError);
  });

  it('returns data on successful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: '1', email: 'test@keel.dev' } }),
    } as Response);

    const result = await api.get('/auth/me');
    expect(result).toEqual({ data: { id: '1', email: 'test@keel.dev' } });
  });

  it('includes Authorization header when token is set', async () => {
    api.setToken('my-jwt');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response);

    await api.get('/projects');
    const call = fetchSpy.mock.calls[0];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-jwt');
  });

  it('handles 204 no-content responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => ({}),
    } as Response);

    const result = await api.delete('/projects/my-app');
    expect(result).toEqual({});
  });
});

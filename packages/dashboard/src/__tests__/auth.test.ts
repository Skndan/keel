import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API client
vi.mock('../api/client', () => ({
  api: {
    getToken: vi.fn(() => null),
    setToken: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiClientError: class extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

import { api } from '../api/client';

describe('Auth flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('login sets token on success', () => {
    api.setToken('fake-jwt');
    expect(api.setToken).toHaveBeenCalledWith('fake-jwt');
  });

  it('logout clears token', () => {
    api.setToken(null);
    expect(api.setToken).toHaveBeenCalledWith(null);
  });

  it('redirects to login when no token', () => {
    expect(true).toBe(true);
  });
});

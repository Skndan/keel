const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || '/v1';

interface ApiError {
  error: { code: string; message: string };
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('keel_token', token);
    } else {
      localStorage.removeItem('keel_token');
    }
  }

  getToken(): string | null {
    // Always check localStorage first for the current value
    this.token = localStorage.getItem('keel_token');
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.body && typeof options.body === 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const res = await fetch(`${GATEWAY_URL}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 204) return {} as T;

    const data = await res.json();
    if (!res.ok) {
      const err = data as ApiError;
      throw new ApiClientError(
        err.error?.message || 'Request failed',
        err.error?.code || 'UNKNOWN',
        res.status,
      );
    }
    return data;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const api = new ApiClient();

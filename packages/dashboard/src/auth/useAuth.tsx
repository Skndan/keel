import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, ApiClientError } from '../api/client';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = api.getToken();
    if (token) {
      api.get<{ data: { email: string } }>('/auth/me')
        .then((res) => {
          setEmail(res.data.email);
          setIsAuthenticated(true);
        })
        .catch(() => {
          api.setToken(null);
          setIsAuthenticated(false);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (loginEmail: string, password: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await api.post<{ data: { access_token: string } }>('/auth/login', {
        email: loginEmail,
        password,
      });

      api.setToken(res.data.access_token);
      setEmail(loginEmail);
      setIsAuthenticated(true);
      return true;
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Login failed';
      setError(message);
      return false;
    }
  };

  const logout = () => {
    api.setToken(null);
    setEmail(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, email, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

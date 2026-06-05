// ─── Auth Types ───────────────────────────────────────

export interface OAuthState {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  provider: 'google' | 'github';
  created_at: Date;
}

export interface JwtPayload {
  sub: string; // account_id
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
}

export interface RefreshTokenRecord {
  id: string;
  account_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
}

export interface AccountRecord {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  provider: string;
  provider_id: string;
  created_at: Date;
  updated_at: Date;
}

// ─── Project Types ────────────────────────────────────

export interface ProjectRecord {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  db_name: string;
  db_user: string;
  api_key_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKeyPayload {
  project_id: string;
  slug: string;
  db_name: string;
}

// ─── API Types ────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: {
    timestamp: string;
    request_id?: string;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  provider: string;
}

export interface ProjectResponse {
  id: string;
  name: string;
  slug: string;
  api_key: string;
  created_at: string;
}

export interface ProjectListItem {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

// ─── Storage Types ────────────────────────────────────

export interface UploadUrlResponse {
  upload_url: string;
  key: string;
  headers: Record<string, string>;
  expires_in: number;
}

export interface DownloadUrlResponse {
  download_url: string;
  expires_in: number;
}

// ─── Query Types ──────────────────────────────────────

export interface QueryRequest {
  query: string;
  params?: unknown[];
}

export interface QueryResponse {
  rows: unknown[];
  rowCount: number;
  fields?: { name: string; dataTypeID: number }[];
}

// ─── Realtime Types ───────────────────────────────────

export interface WsMessage {
  type: 'subscribe' | 'unsubscribe' | 'data' | 'error' | 'pong';
  channel?: string;
  payload?: unknown;
}

// ─── Worker Types ─────────────────────────────────────

export interface JobPayload {
  type: string;
  data: Record<string, unknown>;
  project_id?: string;
}

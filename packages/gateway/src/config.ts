/**
 * Gateway configuration from environment variables.
 */
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // PostgreSQL master database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://keel:keel_dev@localhost:5432/keel_master',

  // JWT
  jwtSecret: new TextEncoder().encode(
    process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars!!',
  ),
  accessTokenExpiry: '15 minutes',
  refreshTokenExpiry: '30 days',

  // OAuth - Google
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',

  // OAuth - GitHub
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',

  // Cloudflare R2
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || 'keel-storage',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },

  // Application
  baseUrl: process.env.BASE_URL || 'http://localhost',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
} as const;

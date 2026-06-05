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

  // Admin dashboard credentials (email/password login, not OAuth)
  adminEmail: process.env.ADMIN_EMAIL || 'admin@keel.dev',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',

  // Application
  baseUrl: process.env.BASE_URL || 'http://localhost',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
} as const;

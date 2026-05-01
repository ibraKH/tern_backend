export const DEFAULT_PRODUCTION_URL = 'https://hammerhead-app-t8l9y.ondigitalocean.app' as const;

function requireEnv(name: string, message: string): string {
  const value = process.env[name];
  if (!value) throw new Error(message);
  return value;
}

export const FRONTEND_URL = requireEnv(
  'FRONTEND_URL',
  '[config] FRONTEND_URL is required (used for CORS and 404 redirects). Add it to your .env file, e.g. FRONTEND_URL=http://localhost:5173'
);

export const PRODUCTION_URL = process.env.PRODUCTION_URL || DEFAULT_PRODUCTION_URL;

const isProduction = process.env.NODE_ENV === 'production';

export const GMAIL_USER = isProduction
  ? requireEnv('GMAIL_USER', '[config] GMAIL_USER is required in production. Add your Gmail address to .env.')
  : (process.env.GMAIL_USER ?? '');

export const GMAIL_APP_PASSWORD = isProduction
  ? requireEnv('GMAIL_APP_PASSWORD', '[config] GMAIL_APP_PASSWORD is required in production. Generate one at Google Account → Security → App Passwords.')
  : (process.env.GMAIL_APP_PASSWORD ?? '');

export const CORS_ALLOWED_ORIGINS = [
  FRONTEND_URL,
  PRODUCTION_URL,
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
] as const;

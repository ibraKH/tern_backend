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

export const GMAIL_USER = requireEnv(
  'GMAIL_USER',
  '[config] GMAIL_USER is required for sending verification emails. Add your Gmail address to .env, e.g. GMAIL_USER=tern.noreply@gmail.com'
);

export const GMAIL_APP_PASSWORD = requireEnv(
  'GMAIL_APP_PASSWORD',
  '[config] GMAIL_APP_PASSWORD is required. Generate one at Google Account → Security → App Passwords.'
);

export const CORS_ALLOWED_ORIGINS = [
  FRONTEND_URL,
  PRODUCTION_URL,
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
] as const;

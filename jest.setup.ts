process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.JWT_EXPIRES = process.env.JWT_EXPIRES || '1h';
process.env.BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS || '4';
process.env.BCRYPT_PEPPER = process.env.BCRYPT_PEPPER || 'pepper';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
process.env.GMAIL_USER = process.env.GMAIL_USER || 'test@gmail.com';
process.env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'testapppassword';

// Expand DATABASE_URL if it contains ${...} references (needed for integration tests).
if (process.env.DATABASE_URL?.includes('${')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\$\{(\w+)\}/g,
    (_, name) => process.env[name] || ''
  );
}
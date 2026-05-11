/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // Add 'owner' to the model_role enum. In PostgreSQL 12+ this is allowed inside
  // a transaction as long as the new value is not used in the same transaction.
  pgm.sql("ALTER TYPE model_role ADD VALUE IF NOT EXISTS 'owner'");
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  // PostgreSQL does not support removing an enum value directly.
  // Recreate the type without 'owner' and migrate the column.
  pgm.sql(`
    ALTER TYPE model_role RENAME TO model_role_old;
    CREATE TYPE model_role AS ENUM ('viewer', 'editor', 'reviewer');
    ALTER TABLE model_permissions
      ALTER COLUMN role TYPE model_role USING role::text::model_role;
    DROP TYPE model_role_old;
  `);
};

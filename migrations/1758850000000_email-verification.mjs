/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn('auth_users', {
    is_verified: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });

  pgm.createTable('email_verification_tokens', {
    id: { type: 'serial', primaryKey: true },
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'auth_users(id)',
      onDelete: 'CASCADE',
    },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.createIndex('email_verification_tokens', 'user_id', { name: 'idx_evt_user_id' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable('email_verification_tokens', { ifExists: true, cascade: true });
  pgm.dropColumn('auth_users', 'is_verified');
};

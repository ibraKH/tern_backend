/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable('sessions', {
    id: { type: 'serial', primaryKey: true },
    user_id: {
      type: 'integer',
      references: 'auth_users(id)',
      onDelete: 'CASCADE',
    },
    token_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
  }, { ifNotExists: true });

  pgm.createTable('audit_log', {
    id: { type: 'serial', primaryKey: true },
    actor_id: {
      type: 'integer',
      references: 'auth_users(id)',
      onDelete: 'SET NULL',
    },
    actor_email: { type: 'text' },
    action: { type: 'text', notNull: true },
    target_user_id: { type: 'integer' },
    metadata: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.createIndex('sessions', 'user_id', { name: 'idx_sessions_user_id', ifNotExists: true });
  pgm.createIndex('audit_log', 'created_at', { name: 'idx_audit_log_created', ifNotExists: true, order: 'DESC' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropIndex('audit_log', 'created_at', { name: 'idx_audit_log_created', ifExists: true });
  pgm.dropIndex('sessions', 'user_id', { name: 'idx_sessions_user_id', ifExists: true });
  pgm.dropTable('audit_log', { ifExists: true, cascade: true });
  pgm.dropTable('sessions', { ifExists: true, cascade: true });
};

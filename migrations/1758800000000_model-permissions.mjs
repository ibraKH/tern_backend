/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.createType('model_role', ['viewer', 'editor', 'reviewer']);

  pgm.createTable('model_permissions', {
    id:          { type: 'serial', primaryKey: true },
    stm_name:    { type: 'varchar(255)', notNull: true },
    user_email:  { type: 'varchar(255)', notNull: true },
    role:        { type: 'model_role', notNull: true, default: 'viewer' },
    granted_by:  { type: 'varchar(255)' },
    granted_at:  { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.addConstraint('model_permissions', 'fk_model_permissions_stm_name', {
    foreignKeys: {
      columns: 'stm_name',
      references: 'stmmodel(stm_name)',
      onDelete: 'CASCADE',
    },
  });

  // One role per (model, user) pair
  pgm.addConstraint('model_permissions', 'uq_model_permissions_stm_user', {
    unique: ['stm_name', 'user_email'],
  });

  pgm.createIndex('model_permissions', ['stm_name'], {
    name: 'idx_model_permissions_stm_name', ifNotExists: true,
  });
  pgm.createIndex('model_permissions', ['user_email'], {
    name: 'idx_model_permissions_user_email', ifNotExists: true,
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropTable('model_permissions', { ifExists: true });
  pgm.dropType('model_role', { ifExists: true });
};

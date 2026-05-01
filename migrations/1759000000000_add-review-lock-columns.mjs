/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.addColumns('stmmodel', {
    is_locked: { type: 'boolean', notNull: true, default: false },
    locked_by: { type: 'varchar(255)' },
    locked_at: { type: 'timestamp with time zone' },
    lock_reason: { type: 'text' },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropColumns('stmmodel', ['is_locked', 'locked_by', 'locked_at', 'lock_reason']);
};

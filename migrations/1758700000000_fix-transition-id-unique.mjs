/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * Fix: transition_id was globally unique, but the frontend generates
 * transition_id values starting from 1 for every model.  This caused
 * "duplicate key value violates unique constraint" errors when a second
 * model re-used the same transition_id number.
 *
 * Solution: replace the global UNIQUE(transition_id) constraint with a
 * composite UNIQUE(stm_name, transition_id) so the value only needs to
 * be unique *within* a single model.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // 1. Drop the old global unique constraint on transition_id.
  //    node-pg-migrate auto-names unique constraints as "<table>_<column>_key",
  //    so the constraint name is "transitions_transition_id_key".
  pgm.dropConstraint('transitions', 'transitions_transition_id_key');

  // 2. Add a composite unique constraint on (stm_name, transition_id).
  //    This allows the same transition_id number in different models.
  pgm.addConstraint('transitions', 'uq_transitions_stm_transition_id', {
    unique: ['stm_name', 'transition_id'],
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Reverse: drop composite, re-add global unique
  pgm.dropConstraint('transitions', 'uq_transitions_stm_transition_id');

  pgm.addConstraint('transitions', 'transitions_transition_id_key', {
    unique: ['transition_id'],
  });
};

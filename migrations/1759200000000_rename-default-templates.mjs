/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

const RENAMES = [
  ['Primary template for forests and woodlands', 'Woodlands'],
  ['Primary template for Grasslands',            'Grasslands'],
  ['Primary template for shrublands',            'Shrublands'],
];

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  for (const [oldName, newName] of RENAMES) {
    // model_permissions has no ON UPDATE CASCADE — update manually first
    // to avoid FK violation when stmmodel.stm_name changes.
    pgm.sql(`
      UPDATE model_permissions
         SET stm_name = '${newName}'
       WHERE stm_name = '${oldName}';
    `);

    // Updating stmmodel.stm_name cascades automatically to:
    //   states, transitions, model_contributions, method_causal_chain
    //   (all carry ON UPDATE CASCADE on their stm_name FK)
    pgm.sql(`
      UPDATE stmmodel
         SET stm_name = '${newName}'
       WHERE stm_name = '${oldName}';
    `);
  }
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  for (const [oldName, newName] of RENAMES) {
    pgm.sql(`
      UPDATE model_permissions
         SET stm_name = '${oldName}'
       WHERE stm_name = '${newName}';
    `);

    pgm.sql(`
      UPDATE stmmodel
         SET stm_name = '${oldName}'
       WHERE stm_name = '${newName}';
    `);
  }
};

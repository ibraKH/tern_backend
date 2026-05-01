/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.sql(`
    INSERT INTO stmmodel (stm_name, ecosystem_type, is_template)
    VALUES
      ('Primary template for forests and woodlands', 'forest_and_woodland', TRUE),
      ('Primary template for Grasslands',            'grasslands',          TRUE),
      ('Primary template for shrublands',            'shrublands',          TRUE)
    ON CONFLICT (stm_name) DO UPDATE SET is_template = TRUE;
  `);

  pgm.sql(`
    DELETE FROM states
    WHERE stm_name IN (
      'Primary template for forests and woodlands',
      'Primary template for Grasslands',
      'Primary template for shrublands'
    );
  `);

  pgm.sql(`
    INSERT INTO states (stm_name, state_name, condition_lower, condition_upper) VALUES
      ('Primary template for forests and woodlands', 'Close to reference tree layer with close to reference shrub/ground layers',              0.75,  1.0 ),
      ('Primary template for forests and woodlands', 'Close to reference tree layer with modified shrub/ground layers',                        0.5,   0.75),
      ('Primary template for forests and woodlands', 'Close to reference tree layer with highly modified shrub/ground layers',                 0.5,   0.75),
      ('Primary template for forests and woodlands', 'Close to reference tree layer with collapsed/transformer shrub/ground layers',           0.3,   0.5 ),
      ('Primary template for forests and woodlands', 'Modified tree layer with close to reference shrub/ground layers',                        0.5,   0.75),
      ('Primary template for forests and woodlands', 'Modified tree layer with modified shrub/ground layers',                                  0.5,   0.75),
      ('Primary template for forests and woodlands', 'Modified tree layer with highly modified shrub/ground layers',                           0.3,   0.5 ),
      ('Primary template for forests and woodlands', 'Modified tree layer with collapsed/transformer shrub/ground layers',                     0.15,  0.3 ),
      ('Primary template for forests and woodlands', 'Highly modified/absent tree layer with close to reference shrub/ground layers',          0.5,   0.75),
      ('Primary template for forests and woodlands', 'Highly modified/absent tree layer with modified shrub/ground layers',                    0.3,   0.5 ),
      ('Primary template for forests and woodlands', 'Highly modified/absent tree layer with highly modified shrub/ground layers',             0.15,  0.3 ),
      ('Primary template for forests and woodlands', 'Highly modified/absent tree layer with collapsed/transformer shrub/ground layers',       0.05,  0.15),
      ('Primary template for forests and woodlands', 'Collapsed/transformer tree layer with close to reference shrub/ground layers',           0.3,   0.5 ),
      ('Primary template for forests and woodlands', 'Collapsed/transformer tree layer with modified shrub/ground layers',                     0.15,  0.3 ),
      ('Primary template for forests and woodlands', 'Collapsed/transformer tree layer with highly modified shrub/ground layers',              0.05,  0.15),
      ('Primary template for forests and woodlands', 'Collapsed/transformer tree layer with collapsed/transformer shrub/ground layers',        0.0,   0.05),
      ('Primary template for forests and woodlands', 'Cultivated woody with modified/highly modified/collapsed/transformer complementary layers', -9999, -9999),
      ('Primary template for forests and woodlands', 'Crops',                                                                                  0.05,  0.15),
      ('Primary template for forests and woodlands', 'Intensively managed exotic pastures',                                                    0.05,  0.15),
      ('Primary template for forests and woodlands', 'Artificial surfaces and infrastructure',                                                 0.0,   0.05);
  `);

  pgm.sql(`
    INSERT INTO states (stm_name, state_name, condition_lower, condition_upper) VALUES
      ('Primary template for Grasslands', 'Close to reference ground layer with close to reference tree/shrub layers',              0.75,  1.0 ),
      ('Primary template for Grasslands', 'Close to reference ground layer with modified tree/shrub layers',                        0.5,   0.75),
      ('Primary template for Grasslands', 'Close to reference ground layer with highly modified tree/shrub layers',                 0.5,   0.75),
      ('Primary template for Grasslands', 'Close to reference ground layer with collapsed/transformer tree/shrub layers',           0.3,   0.5 ),
      ('Primary template for Grasslands', 'Modified ground layer with close to reference tree/shrub layers',                        0.5,   0.75),
      ('Primary template for Grasslands', 'Modified ground layer with modified tree/shrub layers',                                  0.5,   0.75),
      ('Primary template for Grasslands', 'Modified ground layer with highly modified tree/shrub layers',                           0.3,   0.5 ),
      ('Primary template for Grasslands', 'Modified ground layer with collapsed/transformer tree/shrub layers',                     0.15,  0.3 ),
      ('Primary template for Grasslands', 'Highly modified/absent ground layer with close to reference tree/shrub layers',          0.5,   0.75),
      ('Primary template for Grasslands', 'Highly modified/absent ground layer with modified tree/shrub layers',                    0.3,   0.5 ),
      ('Primary template for Grasslands', 'Highly modified/absent ground layer with highly modified tree/shrub layers',             0.15,  0.3 ),
      ('Primary template for Grasslands', 'Highly modified/absent ground layer with collapsed/transformer tree/shrub layers',       0.05,  0.15),
      ('Primary template for Grasslands', 'Collapsed/transformer ground layer with close to reference tree/shrub layers',           0.3,   0.5 ),
      ('Primary template for Grasslands', 'Collapsed/transformer ground layer with modified tree/shrub layers',                     0.15,  0.3 ),
      ('Primary template for Grasslands', 'Collapsed/transformer ground layer with highly modified tree/shrub layers',              0.05,  0.15),
      ('Primary template for Grasslands', 'Collapsed/transformer ground layer with collapsed/transformer tree/shrub layers',        0.0,   0.05),
      ('Primary template for Grasslands', 'Cultivated woody with modified/highly modified/collapsed/transformer complementary layers', -9999, -9999),
      ('Primary template for Grasslands', 'Crops',                                                                                  0.05,  0.15),
      ('Primary template for Grasslands', 'Intensively managed exotic pastures',                                                    0.05,  0.15),
      ('Primary template for Grasslands', 'Artificial surfaces and infrastructure',                                                 0.0,   0.05);
  `);

  pgm.sql(`
    INSERT INTO states (stm_name, state_name, condition_lower, condition_upper) VALUES
      ('Primary template for shrublands', 'Close to reference shrub layer with close to reference tree/ground layers',              0.75,  1.0 ),
      ('Primary template for shrublands', 'Close to reference shrub layer with modified tree/ground layers',                        0.5,   0.75),
      ('Primary template for shrublands', 'Close to reference shrub layer with highly modified tree/ground layers',                 0.5,   0.75),
      ('Primary template for shrublands', 'Close to reference shrub layer with collapsed/transformer tree/ground layers',           0.3,   0.5 ),
      ('Primary template for shrublands', 'Modified shrub layer with close to reference tree/ground layers',                        0.5,   0.75),
      ('Primary template for shrublands', 'Modified shrub layer with modified tree/ground layers',                                  0.5,   0.75),
      ('Primary template for shrublands', 'Modified shrub layer with highly modified tree/ground layers',                           0.3,   0.5 ),
      ('Primary template for shrublands', 'Modified shrub layer with collapsed/transformer tree/ground layers',                     0.15,  0.3 ),
      ('Primary template for shrublands', 'Highly modified/absent shrub layer with close to reference tree/ground layers',          0.5,   0.75),
      ('Primary template for shrublands', 'Highly modified/absent shrub layer with modified tree/ground layers',                    0.3,   0.5 ),
      ('Primary template for shrublands', 'Highly modified/absent shrub layer with highly modified tree/ground layers',             0.15,  0.3 ),
      ('Primary template for shrublands', 'Highly modified/absent shrub layer with collapsed/transformer tree/ground layers',       0.05,  0.15),
      ('Primary template for shrublands', 'Collapsed/transformer shrub layer with close to reference tree/ground layers',           0.3,   0.5 ),
      ('Primary template for shrublands', 'Collapsed/transformer shrub layer with modified tree/ground layers',                     0.15,  0.3 ),
      ('Primary template for shrublands', 'Collapsed/transformer shrub layer with highly modified tree/ground layers',              0.05,  0.15),
      ('Primary template for shrublands', 'Collapsed/transformer shrub layer with collapsed/transformer tree/ground layers',        0.0,   0.05),
      ('Primary template for shrublands', 'Cultivated woody with modified/highly modified/collapsed/transformer complementary layers', -9999, -9999),
      ('Primary template for shrublands', 'Crops',                                                                                  0.05,  0.15),
      ('Primary template for shrublands', 'Intensively managed exotic pastures',                                                    0.05,  0.15),
      ('Primary template for shrublands', 'Artificial surfaces and infrastructure',                                                 0.0,   0.05);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM stmmodel
    WHERE stm_name IN (
      'Primary template for forests and woodlands',
      'Primary template for Grasslands',
      'Primary template for shrublands'
    );
  `);
};

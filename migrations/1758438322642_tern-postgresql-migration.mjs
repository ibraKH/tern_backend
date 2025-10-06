// 1758439000000_eks-schema.mjs
/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // 1) PostGIS extension
  pgm.createExtension('postgis', { ifNotExists: true });
  pgm.createExtension('citext', { ifNotExists: true });

  // 2) Enumerated types
  pgm.createType('attribute_types', [
    'max_canopy_cover_perc',
    'native_canopy_dominance',
    'max_canopy_height',
    'sapling_cover',
    'max_midstorey_cover',
    'min_midstorey_cover',
    'min_goundstorey_cover',
    'max_goundstorey_cover',
    'understorey_cover_non_canopy',
    'native_understorey_dominance',
    'pioneer_species_abundance',
    'understorey_diversity',
    'native_forb_cover',
    'native_forb_richness',
    'canopy_native_diversity',
    'soil_nutrients',
  ], { ifNotExists: true });

  pgm.createType('chain_part_type', [
    'Management Intervention',
    'Favorable abiotic factor',
    'Biotic process',
    'Hazard',
  ], { ifNotExists: true });

  pgm.createType('elicatation_type', [
    'Pilot region',
    'NEAP estimate',
  ], { ifNotExists: true });

  pgm.createType('contribution_type', ['Author', 'Reviewer'], { ifNotExists: true });

  pgm.createType('vast_class_type', ['ClassI', 'ClassII', 'ClassIII', 'ClassIV', 'ClassV', 'ClassVI'], { ifNotExists: true });

  pgm.createType('driver_types', ['biotic', 'abiotic', 'hazard'], { ifNotExists: true });

  pgm.createType('auth_role', ['Admin', 'Editor', 'Viewer'], { ifNotExists: true });

  // 3) Core tables
  pgm.createTable('stmmodel', {
    id: 'id',
    stm_name: { type: 'varchar(255)', notNull: true, unique: true },
    version: 'varchar(100)',
    release_date: 'date',
    authorised_by: 'varchar(255)',
    region: 'varchar(255)',
    region_id: 'integer',
    ecosystem_type: 'varchar(255)',
    aus_eco_archetype_code: 'varchar(255)',
    aus_eco_archetype_name: 'varchar(255)',
    aus_eco_umbrella_code: 'integer',
    peer_reviewed: 'varchar(50)',
    no_peer_reviewers: 'integer',
    climate: 'varchar(255)',
  }, { ifNotExists: true });

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'stmmodel'::regclass
          AND contype = 'p'
      ) THEN
        ALTER TABLE stmmodel ADD CONSTRAINT stmmodel_pkey PRIMARY KEY (id);
      END IF;
    END$$;
  `);


  pgm.createTable('regions', {
    id: 'id',
    region_boundary: { type: 'geometry' },
    ibra_sub_region_id: 'varchar(100)',
    region_description: 'varchar(1000)',
  }, { ifNotExists: true });

  // FK: stmmodel.region_id -> regions(id)
  pgm.addConstraint('stmmodel', 'fk_stmmodel_region', {
    foreignKeys: {
      columns: 'region_id',
      references: 'regions(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });

  pgm.createTable('vast_states', {
    id: 'id',
    vast_class: 'vast_class_type',
    vast_name: 'varchar(255)',
    eks_overstorey_class: 'varchar(255)',
    eks_understorey_class: 'varchar(255)',
    vast_condition_lower: 'double precision',
    vast_condition_upper: 'double precision',
    eks_substate_condition_estimate: 'double precision',
    eks_substate: 'varchar(255)',
    link: 'varchar(1000)',
  }, { ifNotExists: true });

  pgm.createTable('states', {
    id: 'id',
    stm_name: { type: 'varchar(255)', notNull: true },
    state_name: 'varchar(255)',
    vast_state_id: 'integer',
    eks_condition_estimate: 'double precision',
    condition_lower: 'double precision',
    condition_upper: 'double precision',
    // Note: column name follows the source file’s spelling
    ellictation_type: 'elicatation_type',
  }, { ifNotExists: true });

  // FKs: states
  pgm.addConstraint('states', 'fk_states_stmmodel_name', {
    foreignKeys: {
      columns: 'stm_name',
      references: 'stmmodel(stm_name)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('states', 'fk_states_vast', {
    foreignKeys: {
      columns: 'vast_state_id',
      references: 'vast_states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });

  pgm.createTable('questions', {
    id: 'id',
    question: 'varchar(2000)',
  }, { ifNotExists: true });

  pgm.createTable('methods', {
    id: 'id',
    method_name: 'varchar(255)',
    method_description: 'varchar(2000)',
  }, { ifNotExists: true });

  pgm.createTable('method_alignment', {
    id: 'id',
    stm_name: { type: 'varchar(255)', notNull: true },
    method_name: 'varchar(255)',
    method_id: 'integer',
    alignment_approver: 'varchar(255)',
    alignment_date: 'varchar(50)',
    decision_tree: 'integer',
  }, { ifNotExists: true });

  // FKs: method_alignment
  pgm.addConstraint('method_alignment', 'fk_method_alignment_stm', {
    foreignKeys: {
      columns: 'stm_name',
      references: 'stmmodel(stm_name)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('method_alignment', 'fk_method_alignment_method', {
    foreignKeys: {
      columns: 'method_id',
      references: 'methods(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });

  pgm.createTable('eligible_start_states', {
    id: 'id',
    method_alignment_id: { type: 'integer', notNull: true },
    state_id: { type: 'integer', notNull: true },
    state_name: 'varchar(255)',
    condition: 'double precision',
    method_state_mapping: 'varchar(255)',
  }, { ifNotExists: true });

  pgm.createTable('eligible_end_states', {
    id: 'id',
    method_alignment_id: { type: 'integer', notNull: true },
    state_id: { type: 'integer', notNull: true },
    state_name: 'varchar(255)',
    condition: 'double precision',
    method_state: 'varchar(255)',
  }, { ifNotExists: true });

  pgm.createTable('transitions', {
    id: 'id',
    stm_name: { type: 'varchar(255)', notNull: true },
    start_state_id: { type: 'integer', notNull: true },
    end_state_id: { type: 'integer', notNull: true },
    transition_id: { type: 'integer', unique: true },
    time_100: 'double precision',
    time_25: 'double precision',
    likelihood_25: 'double precision',
    likelihood_100: 'double precision',
    transition_delta: 'double precision',
  }, { ifNotExists: true });

  // FKs: transitions
  pgm.addConstraint('transitions', 'fk_transitions_stmmodel_name', {
    foreignKeys: {
      columns: 'stm_name',
      references: 'stmmodel(stm_name)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('transitions', 'fk_transitions_start_state', {
    foreignKeys: {
      columns: 'start_state_id',
      references: 'states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('transitions', 'fk_transitions_end_state', {
    foreignKeys: {
      columns: 'end_state_id',
      references: 'states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
  });

  pgm.createTable('drivers', {
    id: 'id',
    driver: 'varchar(255)',
    description: 'varchar(2000)',
    driver_group: 'varchar(255)',
  }, { ifNotExists: true });

  pgm.createTable('sub_drivers', {
    id: 'id',
    driver_type: 'driver_types',
    driver_description: 'varchar(1000)',
    management_driver_id: 'integer',
  }, { ifNotExists: true });

  // FK: sub_drivers -> drivers
  pgm.addConstraint('sub_drivers', 'fk_sub_drivers_driver', {
    foreignKeys: {
      columns: 'management_driver_id',
      references: 'drivers(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });

  pgm.createTable('causal_chain', {
    id: 'id',
    transition_id: 'integer', // refers to transitions.id
    name: 'varchar(255)',
    chain_part: 'chain_part_type',
    driver_id: 'integer',
  }, { ifNotExists: true });

  // FKs: causal_chain
  pgm.addConstraint('causal_chain', 'fk_causal_chain_transition', {
    foreignKeys: {
      columns: 'transition_id',
      references: '"transitions"("transition_id")',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });
  pgm.addConstraint('causal_chain', 'fk_causal_chain_driver', {
    foreignKeys: {
      columns: 'driver_id',
      references: 'drivers(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });

  pgm.createTable('aus_ecomodel_archetype', {
    id: 'id',
    archetype_no: 'varchar(255)',
    number: { type: 'varchar(255)', unique: true },
    umbrella_class: 'varchar(255)',
    mvg_group_nvis_v4_1: 'varchar(255)',
    mvg_number: 'varchar(255)',
    archetype_model: 'varchar(255)',
    expression: 'varchar(2000)',
    iucn_get_realm: 'varchar(255)',
    iucn_get_biome: 'varchar(255)',
    iucn_ecosystem_functional_group: 'varchar(255)',
  }, { ifNotExists: true });

  // FK: stmmodel.aus_eco_archetype_code -> aus_ecomodel_archetype.number
  pgm.addConstraint('stmmodel', 'fk_stmmodel_archetype', {
    foreignKeys: {
      columns: 'aus_eco_archetype_code',
      references: 'aus_ecomodel_archetype(number)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });

  pgm.createTable('contributors', {
    id: 'id',
    name: 'varchar(255)',
    email: { type: 'citext', notNull: true, unique: true },
  }, { ifNotExists: true });

  pgm.createTable('model_contributions', {
  id: 'id',
  stm_id: { type: 'integer', notNull: true },
  contributor_id: { type: 'integer', notNull: true },
  contribution_type: { type: 'contribution_type', notNull: true },
  }, { ifNotExists: true });

  pgm.addConstraint('model_contributions', 'fk_mc_model', {
    foreignKeys: {
      columns: 'stm_id',
      references: 'stmmodel(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });

  pgm.addConstraint('model_contributions', 'fk_mc_contributor', {
    foreignKeys: {
      columns: 'contributor_id',
      references: 'contributors(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });

  pgm.addConstraint('model_contributions', 'uq_mc_unique_pair', {
  unique: ['stm_id', 'contributor_id'],
  });

  pgm.createTable('auth_users', {
    id: { type: 'serial', primaryKey: true },
    email: { type: 'varchar(255)', notNull: true , unique: true },
    password_hash: { type: 'text', notNull: true },
    role: { type: 'auth_role', notNull: true, default: 'Viewer' },
    contributor_id: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  }, { ifNotExists: true });

  pgm.addConstraint('auth_users', 'fk_auth_users_contributor', {
    foreignKeys: {
      columns: 'contributor_id',
      references: 'contributors(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    }
  });

  pgm.createTable('vast_class_to_states', {
    id: 'id',
    method_alignment_id: { type: 'integer', notNull: true },
    vast_class: 'vast_class_type',
    decision_tree_id: { type: 'integer', unique: true },
  }, { ifNotExists: true });

  // FK: vcts.method_alignment_id -> method_alignment(id)
  pgm.addConstraint('vast_class_to_states', 'fk_vcts_method_alignment', {
    foreignKeys: {
      columns: 'method_alignment_id',
      references: 'method_alignment(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });

  pgm.createTable('decision_tree_nodes', {
    node_id: 'id',
    decision_tree_id: { type: 'integer', notNull: true },
    question_id: 'integer',
    true_eks_state_id: 'integer',
    true_method_state_id: 'varchar(255)',
    true_next_question_id: 'integer',
    false_method_state_id: 'varchar(255)',
    false_eks_state_id: 'integer',
    false_next_question_id: 'integer',
    result_type_true: 'varchar(255)',
    result_type_false: 'varchar(255)',
  }, { ifNotExists: true });

  // FKs: decision_tree_nodes
  pgm.addConstraint('decision_tree_nodes', 'fk_dtn_tree', {
    foreignKeys: {
      columns: 'decision_tree_id',
      references: 'vast_class_to_states(decision_tree_id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('decision_tree_nodes', 'fk_dtn_q', {
    foreignKeys: {
      columns: 'question_id',
      references: 'questions(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });
  pgm.addConstraint('decision_tree_nodes', 'fk_dtn_true_state', {
    foreignKeys: {
      columns: 'true_eks_state_id',
      references: 'states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });
  pgm.addConstraint('decision_tree_nodes', 'fk_dtn_false_state', {
    foreignKeys: {
      columns: 'false_eks_state_id',
      references: 'states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });
  pgm.addConstraint('decision_tree_nodes', 'fk_dtn_true_next_q', {
    foreignKeys: {
      columns: 'true_next_question_id',
      references: 'questions(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });
  pgm.addConstraint('decision_tree_nodes', 'fk_dtn_false_next_q', {
    foreignKeys: {
      columns: 'false_next_question_id',
      references: 'questions(id)',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
  });

  // Eligible sets FKs
  pgm.addConstraint('eligible_start_states', 'fk_ess_method_alignment', {
    foreignKeys: {
      columns: 'method_alignment_id',
      references: 'method_alignment(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('eligible_start_states', 'fk_ess_state', {
    foreignKeys: {
      columns: 'state_id',
      references: 'states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('eligible_end_states', 'fk_ees_method_alignment', {
    foreignKeys: {
      columns: 'method_alignment_id',
      references: 'method_alignment(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('eligible_end_states', 'fk_ees_state', {
    foreignKeys: {
      columns: 'state_id',
      references: 'states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });

  pgm.createTable('state_attributes', {
    id: 'id',
    state_id: { type: 'integer', notNull: true },
    attribute_type: { type: 'attribute_types', notNull: true },
    value: 'varchar(255)',
    units: 'varchar(50)',
  }, { ifNotExists: true });

  pgm.addConstraint('state_attributes', 'fk_state_attributes_state', {
    foreignKeys: {
      columns: 'state_id',
      references: 'states(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });

  pgm.createTable('applicable_land_cover_classes', {
    id: 'id',
    landuse_type: 'varchar(255)',
    landuse_description: 'varchar(1000)',
  }, { ifNotExists: true });

  pgm.createTable('method_causal_chain', {
    id: 'id',
    transition_id: 'integer',
    method_alignment_id: 'integer',
    causal_chain_id: 'integer',
  }, { ifNotExists: true });

  // FKs: method_causal_chain
  pgm.addConstraint('method_causal_chain', 'fk_mcc_transition', {
    foreignKeys: {
      columns: 'transition_id',
      references: '"transitions"("transition_id")',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('method_causal_chain', 'fk_mcc_method_alignment', {
    foreignKeys: {
      columns: 'method_alignment_id',
      references: 'method_alignment(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });
  pgm.addConstraint('method_causal_chain', 'fk_mcc_causal_chain', {
    foreignKeys: {
      columns: 'causal_chain_id',
      references: 'causal_chain(id)',
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  });

  // 4) Helpful indexes
  pgm.createIndex('states', 'stm_name', { name: 'idx_states_stm_name', ifNotExists: true });
  pgm.createIndex('states', 'vast_state_id', { name: 'idx_states_vast_state_id', ifNotExists: true });
  pgm.createIndex('transitions', 'stm_name', { name: 'idx_transitions_stm_name', ifNotExists: true });
  pgm.createIndex('transitions', 'start_state_id', { name: 'idx_transitions_start_state', ifNotExists: true });
  pgm.createIndex('transitions', 'end_state_id', { name: 'idx_transitions_end_state', ifNotExists: true });
  pgm.createIndex('causal_chain', 'transition_id', { name: 'idx_causal_chain_transition', ifNotExists: true });
  pgm.createIndex('causal_chain', 'driver_id', { name: 'idx_causal_chain_driver', ifNotExists: true });
  pgm.createIndex('method_alignment', 'stm_name', { name: 'idx_method_alignment_stm', ifNotExists: true });
  pgm.createIndex('method_alignment', 'method_id', { name: 'idx_method_alignment_method', ifNotExists: true });
  pgm.createIndex('vast_class_to_states', 'decision_tree_id', { name: 'idx_vcts_decision_tree_id', ifNotExists: true });
  pgm.createIndex('decision_tree_nodes', 'question_id', { name: 'idx_dtn_question', ifNotExists: true });
  pgm.createIndex('state_attributes', 'state_id', { name: 'idx_state_attributes_state', ifNotExists: true });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop indexes
  pgm.dropIndex('state_attributes', 'state_id', { name: 'idx_state_attributes_state', ifExists: true });
  pgm.dropIndex('decision_tree_nodes', 'question_id', { name: 'idx_dtn_question', ifExists: true });
  pgm.dropIndex('vast_class_to_states', 'decision_tree_id', { name: 'idx_vcts_decision_tree_id', ifExists: true });
  pgm.dropIndex('method_alignment', 'method_id', { name: 'idx_method_alignment_method', ifExists: true });
  pgm.dropIndex('method_alignment', 'stm_name', { name: 'idx_method_alignment_stm', ifExists: true });
  pgm.dropIndex('causal_chain', 'driver_id', { name: 'idx_causal_chain_driver', ifExists: true });
  pgm.dropIndex('causal_chain', 'transition_id', { name: 'idx_causal_chain_transition', ifExists: true });
  pgm.dropIndex('transitions', 'end_state_id', { name: 'idx_transitions_end_state', ifExists: true });
  pgm.dropIndex('transitions', 'start_state_id', { name: 'idx_transitions_start_state', ifExists: true });
  pgm.dropIndex('transitions', 'stm_name', { name: 'idx_transitions_stm_name', ifExists: true });
  pgm.dropIndex('states', 'vast_state_id', { name: 'idx_states_vast_state_id', ifExists: true });
  pgm.dropIndex('states', 'stm_name', { name: 'idx_states_stm_name', ifExists: true });
  pgm.dropIndex('model_contributions', 'contributor_id', { name: 'idx_mc_contributor_id', ifExists: true });
  pgm.dropIndex('model_contributions', 'stm_id', { name: 'idx_mc_stm_id', ifExists: true });

  // Drop tables (reverse dependency order)
  pgm.dropTable('method_causal_chain', { ifExists: true, cascade: true });
  pgm.dropTable('auth_users', { ifExists: true, cascade: true });
  pgm.dropTable('applicable_land_cover_classes', { ifExists: true, cascade: true });
  pgm.dropTable('state_attributes', { ifExists: true, cascade: true });
  pgm.dropTable('eligible_end_states', { ifExists: true, cascade: true });
  pgm.dropTable('eligible_start_states', { ifExists: true, cascade: true });
  pgm.dropTable('decision_tree_nodes', { ifExists: true, cascade: true });
  pgm.dropTable('vast_class_to_states', { ifExists: true, cascade: true });
  pgm.dropTable('contributors', { ifExists: true, cascade: true });
  pgm.dropTable('model_contributions', { ifExists: true, cascade: true });
  pgm.dropTable('aus_ecomodel_archetype', { ifExists: true, cascade: true });
  pgm.dropTable('causal_chain', { ifExists: true, cascade: true });
  pgm.dropTable('sub_drivers', { ifExists: true, cascade: true });
  pgm.dropTable('drivers', { ifExists: true, cascade: true });
  pgm.dropTable('transitions', { ifExists: true, cascade: true });
  pgm.dropTable('methods', { ifExists: true, cascade: true });
  pgm.dropTable('method_alignment', { ifExists: true, cascade: true });
  pgm.dropTable('questions', { ifExists: true, cascade: true });
  pgm.dropTable('states', { ifExists: true, cascade: true });
  pgm.dropTable('vast_states', { ifExists: true, cascade: true });
  pgm.dropConstraint('stmmodel', 'fk_stmmodel_archetype', { ifExists: true });
  pgm.dropTable('regions', { ifExists: true, cascade: true });
  pgm.dropConstraint('stmmodel', 'fk_stmmodel_region', { ifExists: true });
  pgm.dropTable('stmmodel', { ifExists: true, cascade: true });

  // Drop enums
  pgm.dropType('driver_types', { ifExists: true });
  pgm.dropType('vast_class_type', { ifExists: true });
  pgm.dropType('contribution_type', { ifExists: true });
  pgm.dropType('elicatation_type', { ifExists: true });
  pgm.dropType('chain_part_type', { ifExists: true });
  pgm.dropType('attribute_types', { ifExists: true });

  // Drop PostGIS
  pgm.dropExtension('postgis', { ifExists: true });
};

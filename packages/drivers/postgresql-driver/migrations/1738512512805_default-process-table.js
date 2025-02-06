/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable('process', {
    id: {
      type: 'varchar(9)',
      notNull: true,
      primaryKey: true,
    },
    hostname: {
      type: 'varchar(42)',
      notNull: true,
    },
    port: {
      type: 'integer',
      notNull: true,
    },
    secure: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    pathname: {
      type: 'varchar(255)',
      default: null
    },
    locked: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    metadata: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
    },
    createdAt: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    updatedAt: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
  })

  pgm.createTrigger('process', 'set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  pgm.createIndex('process', 'locked', {
    name: 'idx_process_locked'
  });

  pgm.createIndex('process', 'createdAt', {
    name: 'idx_process_created_at'
  });

  pgm.createIndex('process', 'updatedAt', {
    name: 'idx_process_updated_at'
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTrigger('process', 'set_updated_at', {
    ifExists: true
  });

  pgm.dropTable('process');
};

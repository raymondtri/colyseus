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
  pgm.createTable('room', {
    id: {
      type: 'varchar(9)',
      notNull: true,
      primaryKey: true
    },
    processId: {
      type: 'varchar(9)',
      notNull: true,
      references: '"process"',
      onDelete: 'CASCADE'
    },
    name: {
      type: 'varchar(255)',
      notNull: true
    },
    clients: {
      type: 'integer',
      notNull: true,
      default: 0
    },
    maxClients: {
      type: 'integer',
      notNull: true,
      default: 4
    },
    locked: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    unlisted: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    private: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    eligibleForMatchmaking: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    metadata: {
      type: 'jsonb',
      notNull: true,
      default: '{}'
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
    }
  })

  pgm.createTrigger('room', 'set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  // feels silly to index everything but we can literally query by anything
  pgm.createIndex('room', 'processId', {
    name: 'idx_room_process_id'
  });

  pgm.createIndex('room', 'clients', {
    name: 'idx_room_clients'
  });

  pgm.createIndex('room', 'name', {
    name: 'idx_room_name'
  });

  pgm.createIndex('room', 'maxClients', {
    name: 'idx_room_max_clients'
  });

  pgm.createIndex('room', 'locked', {
    name: 'idx_room_locked'
  });

  pgm.createIndex('room', 'unlisted', {
    name: 'idx_room_unlisted'
  });

  pgm.createIndex('room', 'private', {
    name: 'idx_room_private'
  })

  pgm.createIndex('room', 'eligibleForMatchmaking', {
    name: 'idx_room_eligible_for_matchmaking'
  })

  pgm.createIndex('room', 'createdAt', {
    name: 'idx_room_created_at'
  });

  pgm.createIndex('room', 'updatedAt', {
    name: 'idx_room_updated_at'
  });

  // we don't index metadata though, because if you want something to be queryable it should be a column
  // set this up in your own migration
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTrigger('room', 'set_updated_at', {
    ifExists: true
  });
  pgm.dropIndex('room', 'processId');
  pgm.dropIndex('room', 'clients');
  pgm.dropIndex('room', 'name');
  pgm.dropIndex('room', 'maxClients');
  pgm.dropIndex('room', 'locked');
  pgm.dropIndex('room', 'unlisted');
  pgm.dropIndex('room', 'eligibleForMatchmaking');
  pgm.dropIndex('room', 'createdAt');
  pgm.dropIndex('room', 'updatedAt');
  pgm.dropTable('room');
};

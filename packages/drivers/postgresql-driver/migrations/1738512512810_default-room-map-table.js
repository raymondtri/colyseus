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
  // this table contains the defaults for rooms
  // these defaults have to live inside of the database in order for synthetic room creation to work
  pgm.createTable('room_map', {
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

  pgm.createIndex('room_map', 'name', {
    name: 'idx_room_map_name'
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable('room_map');
};

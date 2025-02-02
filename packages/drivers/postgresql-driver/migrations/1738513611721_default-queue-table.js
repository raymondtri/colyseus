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
  pgm.createTable('queue', {
    id: 'id',
    method: {
      type: 'varchar(255)',
      notNull: true
    },
    roomName: {
      type: 'varchar(255)',
      notNull: true
    },
    clientOptions: {
      type: 'jsonb',
      notNull: true,
      default: '{}'
    },
    authOptions: {
      type: 'jsonb',
      notNull: true,
      default: '{}'
    },
    createdAt: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  // importantly, we need to set the queue to be unlogged by default
  // this skips the write ahead log and makes the queue faster
  pgm.sql('ALTER TABLE "queue" SET UNLOGGED');

  pgm.createIndex('queue', 'roomName', {
    name: 'idx_queue_room_name'
  });

  pgm.createIndex('queue', 'createdAt', {
    name: 'idx_queue_created_at'
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable('queue');
};

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
  pgm.createFunction('insert_room', ['roomId varchar(9)', 'processId varchar(9)', 'name varchar(255)', 'clients integer', 'maxClients integer', 'locked boolean', 'unlisted boolean', 'private boolean', 'eligibleForMatchmaking boolean', 'metadata jsonb'], {
    returns: 'void',
    language: 'plpgsql'
  }, `
    BEGIN
      INSERT INTO room (id, "processId", name, clients, "maxClients", locked, unlisted, private, "eligibleForMatchmaking", metadata)
      VALUES (roomId, processId, name, clients, maxClients, locked, unlisted, private, eligibleForMatchmaking, metadata)
      ON CONFLICT (id) DO UPDATE SET "processId" = EXCLUDED."processId", name = EXCLUDED.name, clients = EXCLUDED.clients, "maxClients" = EXCLUDED."maxClients", locked = EXCLUDED.locked, unlisted = EXCLUDED.unlisted, private = EXCLUDED.private, "eligibleForMatchmaking" = EXCLUDED."eligibleForMatchmaking", metadata = EXCLUDED.metadata;
    END;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropFunction('insert_room', ['roomId varchar(9)', 'processId varchar(9)', 'name varchar(255)', 'clients integer', 'maxClients integer', 'locked boolean', 'unlisted boolean', 'private boolean', 'eligibleForMatchmaking boolean', 'metadata jsonb']);
};

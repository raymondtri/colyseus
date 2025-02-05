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
  // this is where you seed the room map
  pgm.sql(`
    INSERT INTO room_map (name, "maxClients", locked, unlisted, private, "eligibleForMatchmaking", metadata)
    VALUES ('MyRoom', 4, false, false, false, true, '{}');
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM room_map WHERE name = 'MyRoom';
  `);
};

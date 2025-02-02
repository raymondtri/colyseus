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
  pgm.createFunction('process_by_roomid', ['roomid varchar(9)'], {
    returns: 'SETOF process',
    language: 'plpgsql',
  }, `
    BEGIN
      SELECT * FROM process WHERE id = (SELECT processId FROM room WHERE id = roomid);
    END;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropFunction('process_by_roomid', ['roomid varchar(9)']);
};

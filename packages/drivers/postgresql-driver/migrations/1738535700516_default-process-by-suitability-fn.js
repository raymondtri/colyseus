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
  pgm.createFunction('process_by_suitability', ['method varchar(255)', 'roomName varchar(255)', 'clientOptions jsonb', 'authOptions jsonb', 'quantity integer'], {
    returns: 'SETOF process',
    language: 'plpgsql'
  }, `
    BEGIN
      RETURN QUERY
        SELECT * FROM process
        WHERE id IN (
          SELECT "processId"
          FROM rooms
          GROUP BY "processId"
          ORDER BY COUNT(clients) ASC
          LIMIT quantity
        );
    END;
  `)
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropFunction('process_by_suitability', ['method varchar(255)', 'roomName varchar(255)', 'clientOptions jsonb', 'authOptions jsonb', 'quantity integer'])
};

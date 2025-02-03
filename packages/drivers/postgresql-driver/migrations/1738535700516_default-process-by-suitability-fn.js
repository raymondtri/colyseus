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
    returns: 'TABLE(id varchar(9), publicAddress varchar(42), secure boolean, pathname varchar(255), locked boolean, metadata jsonb, createdAt timestamp, updatedAt timestamp, count bigint)',
    language: 'plpgsql'
  }, `
    BEGIN
      RETURN QUERY
        WITH process_count AS (
          SELECT "processId", COUNT(clients) AS count
          FROM room
          GROUP BY "processId"
        )

        SELECT p.id, p."publicAddress", p.secure, p.pathname, p.locked, p.metadata, p."createdAt", p."updatedAt", COALESCE(pc.count, 0) as count
        FROM process p
        LEFT JOIN process_count pc ON p.id = pc."processId"
        WHERE p.locked = false;
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

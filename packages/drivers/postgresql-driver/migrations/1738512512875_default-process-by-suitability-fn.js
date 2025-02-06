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
    returns: 'jsonb',
    language: 'plpgsql'
  }, `
    BEGIN
      RETURN (
        WITH process_count AS (
          SELECT "processId", COUNT(clients) AS count
          FROM room
          GROUP BY "processId"
        )

        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'hostname', p.hostname,
            'port', p.port,
            'secure', p.secure,
            'pathname', p.pathname,
            'locked', p.locked,
            'metadata', p.metadata,
            'createdAt', p."createdAt",
            'updatedAt', p."updatedAt",
            'count', COALESCE(pc.count, 0)
          )
        )
        FROM process p
        LEFT JOIN process_count pc ON p.id = pc."processId"
        WHERE p.locked = false
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

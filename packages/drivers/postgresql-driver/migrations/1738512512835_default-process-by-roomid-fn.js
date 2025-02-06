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
    returns: 'jsonb',
    language: 'plpgsql',
  }, `
    BEGIN
      RETURN (
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
            'updatedAt', p."updatedAt"
          )
        )
        FROM (
          SELECT * FROM process 
          WHERE id = (SELECT "processId" FROM room WHERE id = roomid)
        ) p
      );
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

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
  pgm.createFunction('insert_process', ['processId varchar(9)', 'publicAddress varchar(42)', 'secure boolean', 'pathname varchar(255)', 'locked boolean', 'metadata jsonb'], {
    returns: 'void',
    language: 'plpgsql'
  }, `
    DECLARE
      hostname varchar;
      port integer;
    BEGIN
      -- Split publicAddress into hostname and port
      hostname := split_part(publicAddress, ':', 1);
      port := (split_part(publicAddress, ':', 2))::integer;

      INSERT INTO process (id, hostname, port, secure, pathname, locked, metadata)
      VALUES (processId, hostname, port, secure, pathname, locked, metadata)
      ON CONFLICT (id) DO UPDATE SET 
        hostname = EXCLUDED.hostname,
        port = EXCLUDED.port,
        secure = EXCLUDED.secure,
        pathname = EXCLUDED.pathname,
        locked = EXCLUDED.locked,
        metadata = EXCLUDED.metadata;
    END;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropFunction('insert_process', ['processId varchar(9)', 'publicAddress varchar(42)', 'secure boolean', 'pathname varchar(255)', 'locked boolean', 'metadata jsonb']);
};

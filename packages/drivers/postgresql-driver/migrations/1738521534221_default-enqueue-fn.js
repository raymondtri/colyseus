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
  pgm.createFunction('enqueue', ['id varchar(9)', 'method varchar(255)', 'roomName varchar(255)', 'clientOptions jsonb', 'authOptions jsonb'], {
    returns: 'void',
    language: 'plpgsql',
  }, `
    BEGIN
      INSERT INTO queue (id, method, roomName, clientOptions, authOptions) VALUES (id, method, roomName, clientOptions, authOptions);
    END;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropFunction('enqueue', ['id varchar(9)', 'method varchar(255)', 'roomName varchar(255)', 'clientOptions jsonb', 'authOptions jsonb']);
};

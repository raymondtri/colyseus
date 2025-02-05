/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Matchmaker Function
 * This is the moneymaker function that runs and actually matches people into rooms
 * It has sensible defaults but will likely need to be customized for your own game
 */

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */

exports.up = (pgm) => {
  // now we add a cron job to pg_cron to run the matchmaker every 15 seconds
  pgm.createExtension('pg_cron');
  pgm.sql(`
    SELECT cron.schedule('matchmaker', '*/15 * * * *', $$SELECT matchmaker()$$);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    SELECT cron.unschedule('matchmaker');
  `);
  pgm.dropExtension('pg_cron');
};

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
  pgm.createFunction('matchmaker', [], {
    returns: 'void',
    language: 'plpgsql'
  }, `
    DECLARE
      queue_rows RECORD;
      rooms RECORD;
      processes RECORD;
    BEGIN
      -- Select and delete rows from queue table in one atomic operation
      WITH deleted_rows AS (
        DELETE FROM matchmaker_queue
        RETURNING *
      )
      SELECT * INTO queue_rows FROM deleted_rows;

      -- Now we select the available rooms into a variable, this isn't atomic in case a room changes but if an assignment fails, that is "ok" and it will be retried
      SELECT * INTO rooms FROM room WHERE "eligibleForMatchmaking" = true AND locked = false;

      --- Then we select the available processes into a variable, again, atomicity isn't required as this is really just an estimation
      SELECT * INTO processes FROM process WHERE locked = false;

      -- We have 3 kinds of requests that can be handled here
      -- createOrJoin
      -- create
      -- join

      -- The general flow is that we pluck a request from the queue_rows
      -- Then we try to assign it to a room
      -- If we create a room, we push a new room into the rooms variable, and update the processes variable
      -- If we join a room, we update the room in the rooms variable
      -- Finally we dispatch NOTIFY to the request id in the queue_rows so that the request is fulfilled by the api

      -- createOrJoin
      -- First we try to join a room
      FOR queue_rows WHERE queue_rows.type = 'createOrJoin' LOOP




    END;
  `)
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropFunction('matchmaker', [])
};

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
  },`
    DECLARE
      queue_rows RECORD;
      rooms RECORD;
      processes RECORD;
      joinable_room RECORD;
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

      -- handle the straight up creates first
      FOR row IN SELECT * FROM queue_rows WHERE method = 'create' AND "processId" IS NULL LOOP

        -- we need to find a process in processes based on "something" let's just do min clients for now
        UPDATE row SET "processId" = (SELECT id FROM processes ORDER BY clients ASC LIMIT 1) WHERE id = row.id;

        -- now we use the room map to create a synthetic room with default data
        -- a synthetic room is required so that we can create an "expected" room without a process to be matched up later
        INSERT INTO rooms (id, "processId", name, clients, "maxClients", locked, unlisted, private, "eligibleForMatchmaking", metadata)
        VALUES (
          SELECT
            null,
            row."processId",
            name, clients, "maxClients", locked, unlisted, private, "eligibleForMatchmaking", metadata
          FROM room_map WHERE name = row.name
          );

        -- finally we dispatch a NOTIFY so that the request is fulfilled at the gateway
        NOTIFY 'queue_' || row.id, json_build_object(
          'method', 'create',
          'roomName', row.name,
          'options', row."clientOptions",
          'authOptions', row."authOptions",
          'settings', (
            SELECT json_build_object(
              'hostname', hostname,
              'secure', secure,
              'pathname', pathname,
              'port', port
            ) FROM processes WHERE id = row."processId"
          )
        );

      END LOOP;

      -- createOrJoin
      FOR row IN SELECT * FROM queue_rows WHERE method = 'createOrJoin' LOOP
        -- first let's null out the joinable_room
        joinable_room = null;

        -- now let's see if there is a joinable room avaialable
        SELECT * INTO joinable_room FROM rooms WHERE name = row.name AND clients < "maxClients" AND locked = false LIMIT 1;

        IF joinable_room IS NOT NULL THEN
          -- if there is a joinable room, we need to update the room and the queue row
          UPDATE rooms SET clients = clients + 1 WHERE id = joinable_room.id;
          UPDATE row SET "processId" = joinable_room."processId" WHERE id = row.id;

          -- finally we dispatch a NOTIFY so that the request is fulfilled at the gateway
          NOTIFY 'queue_' || row.id, json_build_object(
            'method', 'join',
            'roomName', row.name,
            'options', row."clientOptions",
            'authOptions', row."authOptions",
            'settings', (
              SELECT json_build_object(
                'hostname', hostname,
                'secure', secure,
                'pathname', pathname,
                'port', port
              ) FROM processes WHERE id = joinable_room."processId"
            )
          );

        ELSE
          -- if there isn't a joinable room, we need to create a new room
          -- we need to find a process in processes based on "something" let's just do min clients for now
          UPDATE row SET "processId" = (SELECT id FROM processes ORDER BY clients ASC LIMIT 1) WHERE id = row.id;

          -- now we use the room map to create a synthetic room with default data
          -- a synthetic room is required so that we can create an "expected" room without a process to be matched up later

          INSERT INTO rooms (id, "processId", name, clients, "maxClients", locked, unlisted, private, "eligibleForMatchmaking", metadata)
          VALUES (
            SELECT
              null,
              row."processId",
              name, clients, "maxClients", locked, unlisted, private, "eligibleForMatchmaking", metadata
            FROM room_map WHERE name = row.name
            );

          -- finally we dispatch a NOTIFY so that the request is fulfilled at the gateway
          NOTIFY 'queue_' || row.id, json_build_object(
            'method', 'create',
            'roomName', row.name,
            'options', row."clientOptions",
            'authOptions', row."authOptions",
            'settings', (
              SELECT json_build_object(
                'hostname', hostname,
                'secure', secure,
                'pathname', pathname,
                'port', port
              ) FROM processes WHERE id = row."processId"
            )
          );
        END IF;
      END LOOP;

      -- and now we handle just the joins, since they need to go after the creates and createOrJoin
      FOR row IN SELECT * FROM queue_rows WHERE method = 'join' LOOP
        -- first let's null out the joinable_room
        joinable_room = null;

        -- now let's see if there is a joinable room avaialable
        SELECT * INTO joinable_room FROM rooms WHERE name = row.name AND clients < "maxClients" AND locked = false LIMIT 1;

        IF joinable_room IS NOT NULL THEN
          -- if there is a joinable room, we need to update the room and the queue row
          UPDATE rooms SET clients = clients + 1 WHERE id = joinable_room.id;
          UPDATE row SET "processId" = joinable_room."processId" WHERE id = row.id;

          -- finally we dispatch a NOTIFY so that the request is fulfilled at the gateway
          NOTIFY 'queue_' || row.id, json_build_object(
            'method', 'join',
            'roomName', row.name,
            'options', row."clientOptions",
            'authOptions', row."authOptions",
            'settings', (
              SELECT json_build_object(
                'hostname', hostname,
                'secure', secure,
                'pathname', pathname,
                'port', port
              ) FROM processes WHERE id = joinable_room."processId"
            )
          );
        END IF;
      END LOOP;
    END;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropFunction('matchmaker', [])
};

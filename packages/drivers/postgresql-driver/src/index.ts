import nanoid from 'nanoid';
import { Pool } from 'pg';

import {
  IRoomCache,
  MatchMakerDriver,
  SortOptions,
  debugMatchMaking,
  logger,
  matchMaker
} from '@colyseus/core';

import { RoomData } from './RoomData';
import { eligibleForMatchmaking, eligibleForMatchmakingCallback } from './MatchmakingEligibility';
import { AuthContext } from '@colyseus/core/src';

export type ProcessProperties = {
  [field: string] : any
}

export type PostgresDriverOptions = {
  roomTableName?: string;
  processTableName?: string;
  queueTableName?: string;

  processProperties?: ProcessProperties;

  createBehavior?: 'queue' | 'dispatch';

  externalMatchmaker?: boolean;
  eligibleForMatchmaking?: eligibleForMatchmakingCallback;
}

export class PostgresDriver implements MatchMakerDriver {

  private readonly _client: Pool;
  private readonly _eligibleForMatchmaking: eligibleForMatchmakingCallback;

  private _$localRooms: RoomData[] = [];

  roomTableName: string;
  processTableName: string;
  queueTableName: string;

  createBehavior: 'queue' | 'dispatch';

  processProperties: { [field: string] : any};

  externalMatchmaker: boolean;

  constructor(client: string, options: PostgresDriverOptions) {
    this._client = new Pool({
      connectionTimeoutMillis: 15000, // need adequate time for queue to respond
      idleTimeoutMillis: 5000, // keep it short because once a process is 'settled' there shouldn't be many updates to the db
      connectionString: client,
      max: 3 // more than 3 per process is crazy
    });

    this.roomTableName = options.roomTableName || 'room';
    this.processTableName = options.processTableName || 'process';
    this.queueTableName = options.queueTableName || 'queue';

    this.createBehavior = options.createBehavior || 'dispatch';

    this.processProperties = options.processProperties || {};

    this.externalMatchmaker = options.externalMatchmaker || false;
    this._eligibleForMatchmaking = options.eligibleForMatchmaking || eligibleForMatchmaking;
  }

  get client(){
    return this._client;
  }

  get queueableMethods(){
    return ['joinOrCreate', 'join'].concat(this.createBehavior === 'queue' ? ['create'] : [])
  }

  get dispatchableMethods(){
    return ['joinById', 'reconnect'].concat(this.createBehavior === 'dispatch' ? ['create'] : []);
  }

  // Begin process-level things
  public async register(){
    if(!this.processProperties.processId){
      logger.error("PostgresDriver: processId is required in processProperties");
    }

    if(!this.processProperties.publicAddress){
      logger.error("PostgresDriver: publicAddress is required in processProperties");
    }

    // insert into process table

    const client = await this._client.connect();

    await client.query(`
      SELECT insert_process($1, $2, $3, $4, $5, $6)`,
      [
      this.processProperties.processId,
      this.processProperties.publicAddress,
      this.processProperties.secure || true,
      this.processProperties.pathname || '/',
      this.processProperties.locked || false,
      JSON.stringify(this.processProperties.metadata ?? {})
      ]
    );

    client.release();

    return;
  }

  // what is
  public async shutdown(){

    const client = await this._client.connect();

    const { rowCount } = await client.query(`
      DELETE FROM ${this.processTableName}
      WHERE id = $1;
    `, [this.processProperties.processId]);

    client.release();

    if(rowCount === 0){
      logger.error("PostgresDriver: failed to shutdown process");
    }

    await this._client.end(); // we can safely terminate the pool

    return;
  }

  // cleanup is to remove all rooms associated with the process
  public async cleanup(processId: string){
    const client = await this._client.connect();

    await client.query(`
      DELETE FROM ${this.roomTableName}
      WHERE "processId" = $1;
    `, [processId]);

    client.release();

    this._$localRooms = [];
  }

  public async clear(){
    const client = await this._client.connect();

    await client.query(`
      TRUNCATE ${this.processTableName} CASCADE;
    `)

    await client.query(`
      TRUNCATE ${this.roomTableName} CASCADE;
    `)

    await client.query(`
      TRUNCATE ${this.queueTableName} CASCADE;
    `)

    client.release();
  }

  // end process-level things

  // begin room-level things
  // usage is that it is saved after this function is called
  public createInstance(roomProperties: any = {}){
    const room = new RoomData(roomProperties, this.roomTableName, this._client, this._eligibleForMatchmaking);
    this._$localRooms.push(room)

    return this._$localRooms[this._$localRooms.length - 1];
  }

  public async has(roomId: string){
    if(this.externalMatchmaker){
      return this._$localRooms.some((room) => room.roomId === roomId);
    }

    const client = await this._client.connect();

    const { rowCount } = await client.query(`
      SELECT id FROM ${this.roomTableName}
      WHERE id = $1;
    `, [roomId]);

    client.release();

    return rowCount > 0;
  }

  // querying is for internal use only
  // so if you have an external matchmaker, you don't need to worry about other processes
  // stay in your lane
  public async query(conditions: any, sortOptions?: SortOptions){
    if(this.externalMatchmaker){
      let attempted = 0;
      const findRoomInLocalRooms = () => this._$localRooms.filter((room) => {
        for (const field in conditions) {
          if (
            conditions.hasOwnProperty(field) &&
            room[field] !== conditions[field]
          ) {
            return false;
          }
        }
        return true;
      });

      let rooms = findRoomInLocalRooms();

      while(rooms.length === 0 && attempted < 10){
        await new Promise((resolve) => setTimeout(resolve, 1000));
        rooms = findRoomInLocalRooms();
        attempted++;
      }

      return rooms;
    }

    // this is intentional, if you're using an external matchmaker you should query
    // based on your parameters, directly, or be using the scheduled cron job in the database
    return [];
  }

  public async findOne(conditions: any){
    const rooms = await this.query(conditions);
    return rooms[0];
  }

  // Now we begin the queueing and dispatching functions
  async invokeMethod(method: string, roomNameOrID: string, clientOptions: matchMaker.ClientOptions, authOptions?: AuthContext){
    if(this.queueableMethods.includes(method)){
      return this.queueMethod(method, roomNameOrID, clientOptions, authOptions);
    }

    if(this.dispatchableMethods.includes(method)){
      return this.dispatchMethod(method, roomNameOrID, clientOptions, authOptions);
    }

    logger.error("PostgresDriver: method not found");
  }

  async dispatchMethod(method: string, roomNameOrID: string, clientOptions: matchMaker.ClientOptions, authOptions?: AuthContext){
    if(this.externalMatchmaker){
      throw new Error("PostgresDriver: dispatchMethod is not available when using an external matchmaker");
    }

    const client = await this._client.connect();

    if(method === 'create'){
      // this gets weird because we have to run the whole queryProcessesBy thing
      const { rows } = await client.query(`SELECT process_by_suitability($1, $2, $3, $4, $5)`, [
        method,
        roomNameOrID,
        JSON.stringify(clientOptions),
        authOptions ? JSON.stringify(authOptions) : null,
        1
      ])
      // we probably need to do something about casting these functions back
      // but that's fine for now
      /*
        {
          process_by_suitability: '(QyXU9uOkg,127.0.0.1:2567,t,/,f,"{""taskId"": ""task-1"", ""clusterArn"": ""cluster-1""}","2025-02-03 00:21:34.69768","2025-02-03 00:21:34.69768",0)'
        }
      */

      if(rows.length === 0){
        throw new Error("PostgresDriver: no processes available to dispatch to");
      }

      client.release();

      return rows[0];

    } else {
      const { rows } = await client.query(`SELECT process_by_room_id('${roomNameOrID}')`);

      client.release();

      if(rows.length === 0){
        throw new Error("PostgresDriver: no processes available to dispatch to");
      }

      return rows[0];
    }
  }

  async queueMethod(method: string, roomNameOrId: string, clientOptions: matchMaker.ClientOptions, authOptions?: AuthContext){
    if(this.externalMatchmaker){
      throw new Error("PostgresDriver: queueMethod is not available when using an external matchmaker");
    }

    const requestId = nanoid(9);

    let connectionResolve;
    let connectionReject;

    const promise = new Promise((resolve, reject) => {
      connectionResolve = resolve;
      connectionReject = reject;
    })

    const client = await this._client.connect();

    // now we actually subscribe to the pgnotify for the request
    client.addListener(`queue_${requestId}`, (payload) => {
      connectionResolve({
        err: null,
        payload: JSON.parse(payload)
      });
      client.release();
    });

    setTimeout(() => {
      connectionReject({
        err: "PostgresDriver: timeout",
        payload: null
      });
      client.release();
    }, 15000);

    // and finally we add the request to the queue by calling the enqueue function
    await client.query(`
      SELECT enqueue($1, $2, $3, $4, $5);
      `, [method, roomNameOrId, requestId, JSON.stringify(clientOptions), authOptions ? JSON.stringify(authOptions) : null]);

    return promise;
  }

}
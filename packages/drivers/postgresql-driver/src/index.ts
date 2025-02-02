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

export type PostgresDriverOptions = {
  roomTableName?: string;
  processTableName?: string;
  queueTableName?: string;

  processSchema?: string[];
  roomSchema?: string[];

  processProperties?: { [field: string] : any};

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

  processSchema?: string[];
  roomSchema?: string[];

  createBehavior: 'queue' | 'dispatch';

  processProperties: { [field: string] : any};

  externalMatchmaker: boolean;

  constructor(client: string, options: PostgresDriverOptions = {}) {
    this._client = new Pool({
      connectionTimeoutMillis: 15000, // need adequate time for queue to respond
      idleTimeoutMillis: 5000, // keep it short because once a process is 'settled' there shouldn't be many updates to the db
      connectionString: client,
      max: 3 // more than 3 per process is crazy
    });

    this.roomTableName = options.roomTableName || 'room';
    this.processTableName = options.processTableName || 'process';
    this.queueTableName = options.queueTableName || 'queue';

    this.processSchema = Array.from(new Set([
      'id',
      'publicAddress',
      'secure',
      'pathname',
      'locked',
      'metadata',
      'createdAt',
      'updatedAt',
      ...options.processSchema || [],
    ]));

    this.roomSchema = Array.from(new Set([
      'id',
      'processId',
      'name',
      'clients',
      'maxClients',
      'locked',
      'unlisted',
      'private',
      'eligibleForMatchmaking',
      'metadata',
      'createdAt',
      'updatedAt',
      ...options.roomSchema || [],
    ]))

    this.createBehavior = options.createBehavior || 'dispatch';

    this.processProperties = options.processProperties || {};

    this.externalMatchmaker = options.externalMatchmaker || false;
    this._eligibleForMatchmaking = options.eligibleForMatchmaking || eligibleForMatchmaking;
  }

  get canQuery() {
    return this.processSchema && this.roomSchema;
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

  // we need to connect from the client and then we actually load the schema FROM postgres if it's not defined
  public async loadSchema () {

    const client = await this._client.connect();

    // load process schema from postgres
    const { rows: processSchema } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = '${this.processTableName}';
    `);

    this.processSchema = processSchema.map((row: any) => row.column_name);

    // load room schema from postgres
    const { rows: roomSchema } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = '${this.roomTableName}';
    `);

    client.release();

    this.roomSchema = roomSchema.map((row: any) => row.column_name);
  }

  // Begin process-level things
  public async register(){
    if(!this.processProperties.processId){
      logger.error("PostgresDriver: processId is required in processProperties");
    }

    if(!this.processProperties.publicAddress){
      logger.error("PostgresDriver: publicAddress is required in processProperties");
    }

    const payload:{ [field: string]: boolean | string | number | Date } = {
      id: this.processProperties.processId,
      publicAddress: this.processProperties.publicAddress,
      secure: this.processProperties.secure || false,
      pathname: this.processProperties.pathname || '',
      locked: this.processProperties.locked || false,
      createdAt: new Date(),
    }

    let metadata: any = {};

    // now we need to take a look at the schema and see if we need to add any other fields
    Object.keys(this.processProperties).forEach((field) => {
      if(field === 'processId') return;

      if(!this.processSchema.includes(field)){
        metadata[field] = this.processProperties[field];
      } else if (field === 'metadata'){
        metadata = { ...metadata, ...this.processProperties.metadata };
      } else if (!payload.hasOwnProperty(field)){
        payload[field] = this.processProperties[field];
      }
    })

    payload.metadata = JSON.stringify(metadata);

    // insert into process table

    const client = await this._client.connect();

    const { rowCount } = await client.query(`
      INSERT INTO ${this.processTableName} ("${Object.keys(payload).join('","')}")
      VALUES (${Object.values(payload).map((value, i) => `$${i + 1}`).join(',')});
    `, Object.values(payload));

    await client.release();

    if(rowCount === 0){
      logger.error("PostgresDriver: failed to register process");
    }

    return;
  }

  // what is
  public async shutdown(){

    const client = await this._client.connect();

    const { rowCount } = await client.query(`
      DELETE FROM ${this.processTableName}
      WHERE id = ${this.processProperties.processId};
    `);

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
      WHERE "processId" = ${processId};
    `)

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
    const room = new RoomData(roomProperties, this.roomSchema, this.roomTableName, this._client, this._eligibleForMatchmaking);
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
      WHERE id = ${roomId};
    `)

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
      // TODO

      client.release();

    } else {
      const { rows } = await client.query(`SELECT process_by_room_id('${roomNameOrID}')`);

      if(rows.length === 0){
        throw new Error("PostgresDriver: no processes available to dispatch to");
      }

      const process = rows[0];

      client.release();

      return process;
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
    client.query(`LISTEN queue:${requestId}`)
      .then((outcome) => connectionResolve(outcome))
      .catch((error) => connectionReject(error))
      .finally(() => client.release());

    // and finally we add the request to the queue by calling the enqueue function
    await client.query(`SELECT enqueue('${method}', '${roomNameOrId}', '${requestId}', '${JSON.stringify(clientOptions)}', '${JSON.stringify(authOptions)}')`);

    return promise;
  }

}
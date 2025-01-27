import Redis, { Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'iovalkey';

import {
  IRoomListingData,
  MatchMakerDriver,
  QueryHelpers,
  RoomListingData,
  debugMatchMaking,
  logger
} from '@colyseus/core';

import { RoomData } from './RoomData';
import { MetadataSchema } from './MetadataSchema';

export type ValkeyDriverOptions = {
  roomcachesKey?: string;
  metadataSchema?: MetadataSchema;
}

export class ValkeyDriver implements MatchMakerDriver {
  private readonly _client: Redis | Cluster;
  private readonly _roomcachesKey: string;
  private readonly _metadataSchema: MetadataSchema;

  constructor(valkeyOptions?: ValkeyDriverOptions, options?: number | string | RedisOptions | ClusterNode[], clusterOptions?: ClusterOptions) {
    this._roomcachesKey = valkeyOptions?.roomcachesKey || 'roomcaches';
    this._metadataSchema = {
      clients: 'number',
      locked: 'boolean',
      private: 'boolean',
      maxClients: 'number',
      name: 'string',
      publicAddress: 'string',
      processId: 'string',
      roomId: 'string',
      createdAt: 'number',
      unlisted: 'boolean',
      ...valkeyOptions?.metadataSchema
    }

    this._client = (Array.isArray(options))
      ? new Cluster(options, clusterOptions)
      : new Redis(options as RedisOptions);
  }

  public createInstance(initialValues: any = {}){
    return new RoomData(initialValues, this._client, this._roomcachesKey, this._metadataSchema);
  }

  // we expose the client here in case people just want to do their own raw queries, that's fine.
  public client(){
    return this._client;
  }

  public async has(roomId: string) {
    return await this._client.hexists(this._roomcachesKey, roomId) === 1;
  }

  // this is really just for "nice to have" functionality, since you can query the client directly.
  public async find(conditions: Partial<IRoomListingData&typeof this._metadataSchema>) {
    const conditionalRoomIDs: { [key: string]: string[] } = {};

    await Promise.all(Object.keys(conditions).map(async (field) => {
      conditionalRoomIDs[field] = [];

      if(field === 'roomId'){
        conditionalRoomIDs[field].push(conditions[field]);
        return;
      }

      switch(this._metadataSchema[field]){
        case 'number':
          if(typeof conditions[field] !== 'number'){
            logger.error(`Expected ${field} to be a number, received ${typeof conditions[field]}`);
            return;
          }

          var [err, results] = await this._client.zrangebyscore(`${this._roomcachesKey}:${field}`, conditions[field], conditions[field]);

          if(err){
            logger.error("ValkeyDriver: error finding rooms", err);
          }

          conditionalRoomIDs[field].push(...results);
          break;
        case 'string':
          if(typeof conditions[field] !== 'string'){
            logger.error(`Expected ${field} to be a string, received ${typeof conditions[field]}`);
            return;
          }

          var [err, results] = await this._client.zrangebylex(`${this._roomcachesKey}:${field}`, `[${conditions[field]}`, `[${conditions[field]}\xff`);

          if(err){
            logger.error("ValkeyDriver: error finding rooms", err);
          }

          conditionalRoomIDs[field].push(...results);
          break;
        case 'boolean':
          if(typeof conditions[field] !== 'boolean'){
            logger.error(`Expected ${field} to be a boolean, received ${typeof conditions[field]}`);
            return;
          }

          var [err, results] = await this._client.zrangebyscore(`${this._roomcachesKey}:${field}`, conditions[field] ? 1 : 0, conditions[field] ? 1 : 0);

          if(err){
            logger.error("ValkeyDriver: error finding rooms", err);
          }

          conditionalRoomIDs[field].push(...results);
          break;
        case 'json':
          logger.error(`ValkeyDriver: json fields are not supported for querying`);
          break;
      }
    }));

    // now we need to find the intersection of all of the sets of roomIDs
    const roomIDs = Object.values(conditionalRoomIDs).reduce((acc, val) => acc.filter(x => val.includes(x)));

    // now we load all of the json data from the primary index
    const rooms = [];

    if (roomIDs.length > 0) {
      const [err, roomData] = await this._client.hmget(this._roomcachesKey, ...roomIDs);
      if (err) {
        logger.error("ValkeyDriver: error finding rooms", err);
      } else {
        for (let i = 0; i < roomData.length; i++) {
          rooms.push(new RoomData(JSON.parse(roomData[i]), this._client, this._roomcachesKey, this._metadataSchema));
        }
      }
    }

    return rooms;

  }

  public async cleanup(processId: string){
    const cachedRooms = await this.find({processId});
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, cachedRooms.length);

    const itemsPerCommand = 500;

    // remove rooms in batches of 500
    // I don't know if we even need to limit this to 500, redis can likely handle substantially more
    // but I left it in
    for (let i = 0; i < cachedRooms.length; i += itemsPerCommand) {
      const rooms = cachedRooms.slice(i, i + itemsPerCommand);

      const txn = this._client.multi();

      // remove the primary cache information
      txn.hdel(this._roomcachesKey, ...rooms);

      // iterate through the metadata schema and remove each field
      for (const field in this._metadataSchema){
        txn.zrem(`${this._roomcachesKey}:${field}`, ...rooms);
      }

      const [err, results] = await txn.exec();

      if(err){
        logger.error("ValkeyDriver: error cleaning up rooms", err);
      }
    }
  }

  public findOne(conditions: Partial<IRoomListingData&typeof this._metadataSchema>){
    return this.find(conditions)[0];
  }

  public async shutdown(){
    await this._client.quit();
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public clear() {
    this._client.del(this._roomcachesKey);
    for (const field in this._metadataSchema){
      this._client.del(`${this._roomcachesKey}:${field}`);
    }
  }

}
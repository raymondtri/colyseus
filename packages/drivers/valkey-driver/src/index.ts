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
  roomcachesKey: string;
  metadataSchema: MetadataSchema;
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
  public async find(field: keyof MetadataSchema, value1: string | number | boolean, order?: 'asc' | 'desc', value2?: string | number | boolean) {
    if (this._metadataSchema[field] === 'number' && typeof value1 !== 'number') {
      logger.error(`Expected ${field} to be a number, received ${typeof value1}`);

      return [];
    }

    if (this._metadataSchema[field] === 'string' && typeof value1 !== 'string') {
      logger.error(`Expected ${field} to be a string, received ${typeof value1}`);

      return [];
    }

    if (this._metadataSchema[field] === 'boolean' && typeof value1 !== 'boolean') {
      logger.error(`Expected ${field} to be a boolean, received ${typeof value1}`);

      return [];
    }

    const roomIDs = [];

    if(!value2){

      if(typeof value1 === 'string'){
        const [err, results] = await this._client.zrangebylex(`${this._roomcachesKey}:${field}`, `[${value1}`, `[${value1}\xff`);
        if(err){
          logger.error("ValkeyDriver: error finding rooms", err);
        }
        roomIDs.push(...results);
      } else if(typeof value1 === 'number'){
        const [err, results] = await this._client.zrangebyscore(`${this._roomcachesKey}:${field}`, value1, value1);
        if (err) {
          logger.error("ValkeyDriver: error finding rooms", err);
        }
        roomIDs.push(...results);
      } else if(typeof value1 === 'boolean'){
        const [err, results] = await this._client.zrangebyscore(`${this._roomcachesKey}:${field}`, value1 ? 1 : 0, value1 ? 1 : 0);
        if (err) {
          logger.error("ValkeyDriver: error finding rooms", err);
        }
        roomIDs.push(...results);
      }

    } else if(value2){
      if (this._metadataSchema[field] === 'number' && typeof value2 !== 'number') {
        logger.error(`Expected ${field} to be a number, received ${typeof value2}`);

        return [];
      }

      if (this._metadataSchema[field] === 'string' && typeof value2 !== 'string') {
        logger.error(`Expected ${field} to be a string, received ${typeof value2}`);

        return [];
      }

      if (this._metadataSchema[field] === 'boolean' && typeof value2 !== 'boolean') {
        logger.error(`Expected ${field} to be a boolean, received ${typeof value2}`);

        return [];
      }

      if(typeof value1 === 'string'){ // this is a weird one, you can't really do a range on strings, but you can do a lexicographical range
        const [err, results] = await this._client.zrangebylex(`${this._roomcachesKey}:${field}`, `[${value1}`, `[${value2}\xff`);

        if(err){
          logger.error("ValkeyDriver: error finding rooms", err);
        }
        roomIDs.push(...results);
      } else if(typeof value1 === 'number' && typeof value2 === 'number'){
        if(order === 'asc'){
          const [err, results] = await this._client.zrangebyscore(
            `${this._roomcachesKey}:${field}`,
            value1,
            value2
          );

          if(err){
            logger.error("ValkeyDriver: error finding rooms", err);
          }
          roomIDs.push(...results);
        } else {
          const [err, results] = await this._client.zrevrangebyscore(
            `${this._roomcachesKey}:${field}`,
            value2,
            value1
          );

          if(err){
            logger.error("ValkeyDriver: error finding rooms", err);
          }

          roomIDs.push(...results);
        }
      } else if(typeof value1 === 'boolean' && typeof value2 === 'boolean'){
        if(order === 'asc'){
          const [err, results] = await this._client.zrangebyscore(
            `${this._roomcachesKey}:${field}`,
            value1 ? 1 : 0,
            value2 ? 1 : 0
          );

          if(err){
            logger.error("ValkeyDriver: error finding rooms", err);
          }

          roomIDs.push(...results);
        } else {
          const [err, results] = await this._client.zrevrangebyscore(
            `${this._roomcachesKey}:${field}`,
            value2 ? 1 : 0,
            value1 ? 1 : 0
          );

          if(err){
            logger.error("ValkeyDriver: error finding rooms", err);
          }

          roomIDs.push(...results);
        }
      }
    }

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
    const cachedRooms = await this.find('processId', processId);
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

  public findOne(field: keyof MetadataSchema, value1: string | number | boolean) {
    return this.find(field, value1)[0];
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
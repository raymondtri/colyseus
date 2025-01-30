import Redis, { Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'iovalkey';

import {
  IRoomCache,
  MatchMakerDriver,
  SortOptions,
  RoomCache,
  debugMatchMaking,
  logger
} from '@colyseus/core';

import { RoomData } from './RoomData';
import { MetadataSchema } from './MetadataSchema';

import { eligibleForMatchmaking, eligibleForMatchmakingCallback } from './EligibleForMatchmaking';

import { unserialize } from './Serializer';

export type ValkeyDriverOptions = {
  roomcachesKey?: string;
  metadataSchema?: MetadataSchema;
  externalMatchmaker?: boolean;
  eligibleForMatchmaking?: eligibleForMatchmakingCallback;
}

export class ValkeyDriver implements MatchMakerDriver {
  private readonly _client: Redis | Cluster;
  private readonly _roomcachesKey: string;
  private readonly _metadataSchema: MetadataSchema;
  private readonly _eligibleForMatchmaking: eligibleForMatchmakingCallback;

  private _$localRooms: RoomData[] = [];
  private _$ownProcessId: string;

  externalMatchmaker: boolean; // constrain the driver from only looking in local rooms

  constructor(valkeyOptions?: ValkeyDriverOptions, options?: number | string | RedisOptions | ClusterNode[], clusterOptions?: ClusterOptions) {
    this.externalMatchmaker = valkeyOptions?.externalMatchmaker || false;

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
      eligibleForMatchmaking: 'boolean',
      createdAt: 'number',
      unlisted: 'boolean',
      ...valkeyOptions?.metadataSchema
    }

    if(!valkeyOptions.eligibleForMatchmaking){
      this._eligibleForMatchmaking = eligibleForMatchmaking;
    } else {
      this._eligibleForMatchmaking = valkeyOptions.eligibleForMatchmaking;
    }

    this._client = (Array.isArray(options))
      ? new Cluster(options, clusterOptions)
      : new Redis(options as RedisOptions);
  }

  // createInstance is only called by the matchmaker on the same server as the driver
  public createInstance(initialValues: any = {}){
    if(initialValues.processId){
      this._$ownProcessId = initialValues.processId; // we just snag this here so it's avaialable on shutdown
    }

    const room = new RoomData(initialValues, this._client, this._roomcachesKey, this._metadataSchema, this._eligibleForMatchmaking);

    this._$localRooms.push(room);

    return this.$localRooms[this.$localRooms.length - 1];
  }

  get $localRooms(){
    return this._$localRooms.filter((room) => !room.removed);
  }

  // we expose the client here in case people just want to do their own raw queries, that's fine.
  get client(){
    return this._client;
  }

  public roomCachesKey(){
    return this._roomcachesKey;
  }

  public async has(roomId: string) {
    if(this.externalMatchmaker){
      return this.$localRooms.some((room) => room.roomId === roomId);
    }

    return await this._client.hexists(this._roomcachesKey, roomId) === 1;
  }

  // this is really just for "nice to have" functionality, since you can query the client directly.
  // and in fact, it is recommended that you query the client directly based on your needs for matchmaking filtering
  // this is not adequate for sorting!!!!!!!
  public async query(conditions: Partial<IRoomCache&typeof this._metadataSchema>){
    if(this.externalMatchmaker){
      return this.$localRooms.filter((room) => {
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
    }

    const roomIDs:string[] = [];

    if(conditions.roomId){ // there is no need to process anything else. We can grab it directly
      roomIDs.push(conditions.roomId);
    } else {
      const sets: string[] = [];

      Object.keys(conditions).forEach((field) => {
        if(this._metadataSchema[field] === 'boolean'){
          sets.push(`${this._roomcachesKey}:field:${field}`)
        } else if (this._metadataSchema[field] === 'string'){
          sets.push(`${this._roomcachesKey}:field:${field}:${conditions[field]}`)
        } else if (this._metadataSchema[field] === 'number'){
          sets.push(`${this._roomcachesKey}:field:${field}:${conditions[field]}`)
        }
      })

      roomIDs.push(...await this._client.sinter(...sets));
    }

    if(roomIDs.length === 0) return [];

    const results = await this._client.hmget(this._roomcachesKey, ...roomIDs);

    return results.filter(result => result).map((roomData) => new RoomData(JSON.parse(roomData), this._client, this._roomcachesKey, this._metadataSchema, this._eligibleForMatchmaking));

    // return results.filter(result => result).map((roomData) => new RoomData(unserialize(this._metadataSchema, roomData), this._client, this._roomcachesKey, this._metadataSchema, this._eligibleForMatchmaking));
  }

  public async cleanup(processId: string){
    const cachedRooms = await this.query({processId});
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, cachedRooms.length);

    const itemsPerCommand = 500;

    // remove rooms in batches of 500
    // I don't know if we even need to limit this to 500, redis can likely handle substantially more
    // but I left it in
    for (let i = 0; i < cachedRooms.length; i += itemsPerCommand) {
      const rooms = cachedRooms.slice(i, i + itemsPerCommand);

      if(this.externalMatchmaker){
        this._$localRooms = this._$localRooms.filter((room) => !rooms.includes(room));
      }

      cachedRooms.forEach((room) => room.remove()); // this is sloppy but really shouldn't be used?
    }
  }

  public findOne(conditions: Partial<IRoomCache&typeof this._metadataSchema>){
    return this.query(conditions)[0];
  }

  public async shutdown(){
    // deregister the process
    await this._client.srem(`${this._roomcachesKey}:processes`, this._$ownProcessId);
    // quit the client
    await this._client.quit();
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  // this will break testsuite because it's not possible to know every value of every room string lol
  public clear() {
    this._client.del(this._roomcachesKey);
    for (const field in this._metadataSchema){
      this._client.del(`${this._roomcachesKey}:${field}`);
    }
  }

}
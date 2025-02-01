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

import { eligibleForMatchmaking, eligibleForMatchmakingCallback, processEligibilityScore, processEligibilityScoreCallback, processEligibilityScoreCallbackMap } from './MatchmakingEligibility';

export type ValkeyDriverOptions = {
  roomcachesKey?: string;
  metadataSchema?: MetadataSchema;
  processProperties?: { [field: string]: string | number | boolean };
  externalMatchmaker?: boolean;
  eligibleForMatchmaking?: eligibleForMatchmakingCallback;
  processEligibilityScoreMap?: processEligibilityScoreCallbackMap | processEligibilityScoreCallback;
}

export class ValkeyDriver implements MatchMakerDriver {
  private readonly _client: Redis | Cluster;
  private readonly _roomcachesKey: string;
  private readonly _metadataSchema: MetadataSchema;
  private readonly _eligibleForMatchmaking: eligibleForMatchmakingCallback;
  private readonly _processEligibilityScoreMap: processEligibilityScoreCallbackMap;

  private _$localRooms: RoomData[] = [];

  processProperties: { [field: string]: any } = {};
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
      processEligibilityScore: 'number',
      createdAt: 'number',
      unlisted: 'boolean',
      ...valkeyOptions?.metadataSchema
    }

    this.processProperties = valkeyOptions?.processProperties || {};

    if(valkeyOptions.eligibleForMatchmaking){
      this._eligibleForMatchmaking = valkeyOptions.eligibleForMatchmaking;
    } else {
      this._eligibleForMatchmaking = eligibleForMatchmaking;
    }

    if(typeof valkeyOptions.processEligibilityScoreMap === 'function'){
      this._processEligibilityScoreMap = { '*': valkeyOptions.processEligibilityScoreMap }
    } else if (valkeyOptions.processEligibilityScoreMap){
      this._processEligibilityScoreMap = valkeyOptions.processEligibilityScoreMap;
    } else {
      this._processEligibilityScoreMap = { '*': processEligibilityScore }
    }

    this._client = (Array.isArray(options))
      ? new Cluster(options, clusterOptions)
      : new Redis(options as RedisOptions);

    this.processProperties.createdAt = Date.now();
  }

  // createInstance is only called by the matchmaker on the same server as the driver
  public createInstance(initialValues: any = {}){
    const room = new RoomData(initialValues, this._client, this._roomcachesKey, this._metadataSchema, this._eligibleForMatchmaking, this._processEligibilityScoreMap[initialValues.roomName] ?? this._processEligibilityScoreMap['*']);

    this._$localRooms.push(room);

    return this.$localRooms[this.$localRooms.length - 1];
  }

  get $localRooms(){
    return this._$localRooms.filter((room) => !room.removed);
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
  public async query(conditions: Partial<IRoomCache&typeof this._metadataSchema>, sortOptions?: SortOptions){

    // ok if you're using an external matchmaker this gets wild
    // because create requests (during concurrency) may not have hit the server yet

    if(this.externalMatchmaker){
      let attempted = 0;
      const findRoomInLocalRooms = () => this.$localRooms.filter((room) => {
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

    if(roomIDs.length === 0) return []

    const results = await this._client.hmget(this._roomcachesKey, ...roomIDs);
    return results.filter(result => result).map((roomData) => JSON.parse(roomData));
    // we don't want to actually create new RoomData objects because that doubles the execution time and this is more of a query for information than anything
  }

  get client(): Redis | Cluster {
    return this._client;
  }

  // TODO this needs testing
  public async queryProcesses(conditions: { [field: string]: any } = {}, limit: number = 1){

    const processIDs:string[] = [];
    const processScores: { [processId : string]: number } = {};

    if(Object.keys(conditions).length > 0){
      if(conditions.processId){ // no need to process anything else
        processIDs.push(conditions.processId);
      } else {
        const sets: string[] = [];

        Object.keys(conditions).forEach((field) => {
          if(typeof conditions[field] === 'boolean'){
            sets.push(`${this._roomcachesKey}:processes:field:${field}`)
          } else if (typeof conditions[field] === 'string'){
            sets.push(`${this._roomcachesKey}:processes:field:${field}:${conditions[field]}`)
          } else if (typeof conditions[field] === 'number'){
            sets.push(`${this._roomcachesKey}:processes:field:${field}:${conditions[field]}`)
          }
        })

        processIDs.push(...await this._client.sinter(...sets));
      }

      // early return because there was a query and nothing returned
      if(processIDs.length === 0){
        return [];
      } else {
        const scores = await this._client.zmscore(`${this._roomcachesKey}:processes:field:score`, ...processIDs);
        processIDs.forEach((processId, index) => processScores[processId] = parseInt(scores[index]));
      }
    } else { // no filtering conditions, just grab the processes
      const rankedProcesses = await this._client.zrangebyscore(`${this._roomcachesKey}:processes:field:score`, 0, "+inf", "WITHSCORES", "LIMIT", 0, limit - 1);
      for (let i = 0; i < rankedProcesses.length; i += 2) {
        const processId = rankedProcesses[i];
        const score = parseInt(rankedProcesses[i + 1]);
        processScores[processId] = score;
      }
    }

    if(Object.keys(processScores).length === 0) return [];

    const results = await this._client.hmget(`${this._roomcachesKey}:processes`, ...Object.keys(processScores));
    return results.filter(result => result).map((processData) => {
      let data = JSON.parse(processData);
      return {
        ...data,
        score: processScores[data.processId]
      }
    });
  }

  // this is set up in a way that process values here should never change
  public async register(){

    if(!this.processProperties.processId){
      logger.error("ValkeyDriver: processId must be defined in processProperties");
      return;
    }

    const txn = this._client.multi();

    txn.zadd(`${this._roomcachesKey}:processes:field:score`, this.processProperties.defaultScore ?? 0, this.processProperties.processId);

    for (const field in this.processProperties){ // and we make everything indexable
      if(field === 'processId' || field === 'defaultScore'){ // there is no need to build a processId index that links to the processId lol
        continue;
      }

      let value;

      if(field === 'createdAt'){
        value = new Date(this.processProperties.createdAt).getTime();
      } else {
        value = this.processProperties[field];
      }

      if(typeof value === 'boolean'){
        if(value){
          txn.sadd(`${this._roomcachesKey}:processes:field:${field}`, this.processProperties.processId);
        }
      } else if (typeof value === 'string'){
        txn.sadd(`${this._roomcachesKey}:processes:field:${field}:${value}`, this.processProperties.processId);
      } else if (typeof value === 'number'){
        txn.zadd(`${this._roomcachesKey}:processes:field:${field}`, value, this.processProperties.processId);
        txn.sadd(`${this._roomcachesKey}:processes:field:${field}:${value}`, this.processProperties.processId);
      }
    }

    txn.hset(`${this._roomcachesKey}:processes`, this.processProperties.processId, JSON.stringify(this.processProperties));

    await txn.exec();

    return
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

  // TODO this needs testing too
  public async spliceMatchmakingRequests(): Promise<string[]> {
    const txn = this._client.multi(); // keep it atomic
    txn.smembers('matchmaking:requests');
    txn.del('matchmaking:requests');

    const [requests, _] = await txn.exec();

    if (requests instanceof Error) {
      throw requests;
    }

    return requests as string[];
  }

  public async shutdown(){
    const txn = this._client.multi();

    // deregister the process
    txn.hdel(`${this._roomcachesKey}:processes`, this.processProperties.processId);
    txn.zrem(`${this._roomcachesKey}:processes:field:score`, this.processProperties.processId);

    await txn.exec();

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
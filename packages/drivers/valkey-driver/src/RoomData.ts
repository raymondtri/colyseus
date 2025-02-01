import { RoomCache, logger } from "@colyseus/core";
import Redis, { Cluster } from "iovalkey";

import { MetadataSchema } from "./MetadataSchema";
import { eligibleForMatchmakingCallback, processEligibilityScoreCallback } from "./MatchmakingEligibility";

export class RoomData implements RoomCache {
  public clients: number = 0;
  public locked: boolean = false;
  public private: boolean = false;
  public maxClients: number = Infinity;
  public metadata: { [field: string]: number | string | boolean } = {};
  public name: string;
  public publicAddress: string;
  public processId: string;
  public roomId: string;
  public createdAt: Date;
  public unlisted: boolean = false;

  #client: Redis | Cluster;
  #roomcachesKey: string;
  #metadataSchema: MetadataSchema;
  #processProperties: string[] = [];
  #eligibleForMatchmaking: eligibleForMatchmakingCallback;
  #processEligibilityScore: processEligibilityScoreCallback;

  removed: boolean = false; // need to access this from the outside

  constructor(
    initialValues: any,
    client: Redis | Cluster,
    roomcachesKey: string,
    metadataSchema: MetadataSchema,
    processProperties: string[],
    eligibleForMatchmaking: eligibleForMatchmakingCallback,
    processEligibilityScore: processEligibilityScoreCallback
  ) {
    this.#client = client;
    this.#roomcachesKey = roomcachesKey;
    this.#metadataSchema = metadataSchema;
    this.#processProperties = processProperties;
    this.#eligibleForMatchmaking = eligibleForMatchmaking;
    this.#processEligibilityScore = processEligibilityScore;

    this.createdAt = (initialValues && initialValues.createdAt)
      ? new Date(initialValues.createdAt)
      : new Date();

    for (const field in metadataSchema) {
      if (initialValues.hasOwnProperty(field)) {

        if(this.hasOwnProperty(field)){
          this[field] = initialValues[field];
        } else {
          this.metadata[field] = initialValues[field];

          // then we dynamically build a getter?
          Object.defineProperty(this, field, {
            get: () => this.metadata[field]
          })

        }
      }
    }
  }

  public toJSON() {
    return {
      clients: this.clients,
      createdAt: this.createdAt,
      maxClients: this.maxClients,
      metadata: this.metadata,
      name: this.name,
      publicAddress: this.publicAddress,
      processId: this.processId,
      roomId: this.roomId,
    }
  }

  get eligibleForMatchmaking(){
    return this.#eligibleForMatchmaking(this);
  }

  set eligibleForMatchmaking(value: boolean){ // do nothing here, very important because this should be a dynamic value
    return;
  }

  get processEligibilityScore(){
    return this.#processEligibilityScore(this);
  }

  set processEligibilityScore(value: number){ // do nothing here, very important because this should be a dynamic value
    return;
  }

  public async save() {
    // skip if already removed.
    if (this.removed) {
      return;
    }

    if (!this.roomId) {
      logger.warn("ValkeyDriver: can't .save() without a `roomId`");
      return;
    }

    const fieldKey = `${this.#roomcachesKey}:field`;

    const oldRoomDataResult = await this.#client.hmget(this.#roomcachesKey, this.roomId);
    const oldRoomData = oldRoomDataResult[0] ? JSON.parse(oldRoomDataResult[0]) : null;


    const txn = this.#client.multi();

    // go ahead and make sure the process is in the list of processes
    // these properties must be constant on every room... and they should be.
    const processProperties:any = {};
    this.#processProperties.forEach((property) => {
      if(property.includes(".")){
        const [parent, child] = property.split(".");
        if(!processProperties[parent]){
          processProperties[parent] = {};
        }
        processProperties[parent][child] = this[parent][child];
        return;
      }

      processProperties[property] = this[property];
    });

    txn.hset(`${this.#roomcachesKey}:processes`, this.processId, JSON.stringify(processProperties));

    // and then we record the process eligibility score contribution of this room on the process
    txn.zincrby(`${this.#roomcachesKey}:processes:score`, this.processEligibilityScore - (oldRoomData.processEligibilityScore ?? 0), this.roomId);


    // I think we just set the fields here honestly, we don't need to do anything special
    // then we go through and run SINTER to create a new intersection on the fly?
    for (const field in this.#metadataSchema){
      if(field === 'roomId'){// there is no need to build a roomId index that links to the roomId lol
        continue;
      }

      let value;

      if(field === 'createdAt'){
        value = this.createdAt.getTime();
      } else {
        value = this[field];
      }

      // now we get fancy and create secondary indexes so we can use SINTER to filter on the fly, and even SORT on SINTER to apply filters etc. at the db level
      if(this.#metadataSchema[field] === 'boolean'){
        if(value){
          txn.sadd(`${fieldKey}:${field}`, this.roomId);
        } else {
          txn.srem(`${fieldKey}:${field}`, this.roomId);
        }
      } else if (this.#metadataSchema[field] === 'string'){
        // Get the current value from Redis to remove from old index
        if (oldRoomData && oldRoomData[field] !== value) {
          txn.srem(`${fieldKey}:${field}:${oldRoomData[field]}`, this.roomId);
        }
        txn.sadd(`${fieldKey}:${field}:${value}`, this.roomId);
      } else if (this.#metadataSchema[field] === 'number'){
        // Get the current value from Redis to remove from old index
        if (oldRoomData && oldRoomData[field] !== value) {
          txn.zrem(`${fieldKey}:${field}`, this.roomId);
          txn.srem(`${fieldKey}:${field}:${oldRoomData[field]}`, this.roomId);
        }
        txn.zadd(`${fieldKey}:${field}`, value, this.roomId);
        txn.sadd(`${fieldKey}:${field}:${value}`, this.roomId);
      }
    }

    txn.hset(this.#roomcachesKey, this.roomId, JSON.stringify(this.toJSON()));

    const results = await txn.exec();

    // if there was an error, log it
    /*
    if (err){
      logger.error("ValkeyDriver: error saving room data", err);
    } else {
      logger.debug("ValkeyDriver: saved room data", results);
    }
    */
  }

  public updateOne(operations: any) {
    if (operations.$set) {
      for (const field in operations.$set) {
        this[field] = operations.$set[field];
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        this[field] += operations.$inc[field];
      }
    }

    return this.save();
  }

  public remove() {
    if(this.roomId){
      this.removed = true;

      const fieldKey = `${this.#roomcachesKey}:field`;

      const txn = this.#client.multi();

      txn.zincrby(`${this.#roomcachesKey}:processes:score`, -this.processEligibilityScore, this.roomId);

      // remove all of the fields from the field indexes
      for (const field in this.#metadataSchema) {
        if(field === 'roomId'){
          continue;
        }
        const value = this[field];

        if(this.#metadataSchema[field] === 'boolean'){
          txn.srem(`${fieldKey}:${field}`, this.roomId);
        } else if (this.#metadataSchema[field] === 'string'){
          txn.srem(`${fieldKey}:${field}:${value}`, this.roomId);
        } else if (this.#metadataSchema[field] === 'number'){
          txn.zrem(`${fieldKey}:${field}`, this.roomId);
          txn.srem(`${fieldKey}:${field}:${value}`, this.roomId);
        }

      }

      // remove the room from the room index
      txn.hdel(this.#roomcachesKey, this.roomId);

      return txn.exec();
    }
  }
}
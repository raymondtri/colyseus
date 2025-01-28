import { RoomListingData, logger } from "@colyseus/core";
import Redis, { Cluster } from "iovalkey";

import { MetadataSchema } from "./MetadataSchema";

export class RoomData implements RoomListingData {
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
  #removed: boolean = false;

  constructor(
    initialValues: any,
    client: Redis | Cluster,
    roomcachesKey: string,
    metadataSchema: MetadataSchema
  ) {
    this.#client = client;
    this.#roomcachesKey = roomcachesKey;
    this.#metadataSchema = metadataSchema;

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

  public async save() {
    // skip if already removed.
    if (this.#removed) {
      return;
    }

    if (!this.roomId) {
      logger.warn("ValkeyDriver: can't .save() without a `roomId`");
      return;
    }

    const txn = this.#client.multi();
    // first we set the primary cache information
    txn.hset(this.#roomcachesKey, this.roomId, JSON.stringify(this.toJSON()));
    // then we iterate through the metadata schema and set each field
    for (const field in this.#metadataSchema){
      if(field === 'roomId'){// there is no need to build a roomId index that links to the roomId lol
        continue;
      }

      switch (this.#metadataSchema[field]){
        case 'string':
          // set up a lexographically sorted set for string fields
          // TEST: docs say that this should have 0 as a score but is iovalkey handling this for us?
          txn.zadd(`${this.#roomcachesKey}:${field}`, this[field], this.roomId);
          break;
        case 'number':
          // set up a simple numerical index sorted set for number fields
          txn.zadd(`${this.#roomcachesKey}:${field}`, this[field], this.roomId);
          break;
        case 'boolean':
          // set up a simple numerical index sorted set for boolean fields
          txn.zadd(`${this.#roomcachesKey}:${field}`, this[field] ? 1 : 0, this.roomId);
          break;
        case 'json':
          // do nothing as json is not queryable
          break;
        default:
          // this should _never_ be reachable due to strict typing
          logger.warn(`ValkeyDriver: unknown metadata type ${this.#metadataSchema[field]}`);
          break;
      }
    }

    const [err, results] = await txn.exec();

    // if there was an error, log it
    if (err){
      logger.error("ValkeyDriver: error saving room data", err);
    }
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
      this.#removed = true;

      const txn = this.#client.multi();

      // remove the primary cache information
      txn.hdel(this.#roomcachesKey, this.roomId);

      // iterate through the metadata schema and remove each field
      for (const field in this.#metadataSchema){
        txn.zrem(`${this.#roomcachesKey}:${field}`, this.roomId);
      }

      return txn.exec();
    }
  }
}
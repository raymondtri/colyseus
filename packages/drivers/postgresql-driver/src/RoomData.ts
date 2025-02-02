import { RoomCache, logger } from "@colyseus/core";
import { Pool } from 'pg';

import { eligibleForMatchmakingCallback } from './MatchmakingEligibility';

export class RoomData implements RoomCache {
  public roomId: string;
  public processId: string;
  public name: string;

  public clients: number = 0;
  public maxClients: number = Infinity;

  public locked: boolean = false;
  public unlisted: boolean = false;
  public private: boolean = false;

  public createdAt: Date;

  public metadata: { [field: string]: any } = {};

  #client: Pool;
  #roomTableName: string;
  #eligibleForMatchmaking: eligibleForMatchmakingCallback;

  removed: boolean = false;

  constructor(
    roomProperties: {
      roomId: string,
      processId: string,
      name: string,
      [field: string]: any
    },
    roomTableName: string,
    client: Pool,
    eligibleForMatchmaking: eligibleForMatchmakingCallback
  ) {
    this.#eligibleForMatchmaking = eligibleForMatchmaking;
    this.#client = client;
    this.#roomTableName = roomTableName;

    this.roomId = roomProperties.roomId;
    this.processId = roomProperties.processId;
    this.name = roomProperties.name;

    if(roomProperties.clients) this.clients = roomProperties.clients;
    if(roomProperties.maxClients) this.maxClients = roomProperties.maxClients;

    if(roomProperties.locked) this.locked = roomProperties.locked;
    if(roomProperties.unlisted) this.unlisted = roomProperties.unlisted;
    if(roomProperties.private) this.private = roomProperties.private;

    if(roomProperties.metadata) this.metadata = roomProperties.metadata;

    this.createdAt = (roomProperties && roomProperties.created_at)
      ? new Date(roomProperties.created_at)
      : new Date();
  }

  get eligibleForMatchmaking(){
    return this.#eligibleForMatchmaking(this);
  }

  set eligibleForMatchmaking(value: boolean){ // do nothing
    return;
  }

  public async save(){
    if (this.removed) return;

    // insert into room table
    const client = await this.#client.connect();

    // we use functions here because this allows the driver to remain a black box
    // and the end developer can simply create a different function
    await client.query(`
      SELECT insert_room($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
    `, [
      this.roomId,
      this.processId,
      this.name,
      this.clients,
      this.maxClients,
      this.locked,
      this.unlisted,
      this.private,
      this.eligibleForMatchmaking,
      this.createdAt,
      JSON.stringify(this.metadata)
    ]);

    client.release();

    return;
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

  public async remove() {
    if(!this.roomId) {
      logger.error("PostgresDriver: RoomData.remove() - roomId is required.");
      return;
    }

    this.removed = true;

    const client = await this.#client.connect();

    const { rowCount } = await client.query(`
      DELETE FROM ${this.#roomTableName}
      WHERE id = ${this.roomId};
    `);

    client.release();

    if(rowCount === 0){
      logger.error("PostgresDriver: failed to remove room data");
    }

    return;
  }

}
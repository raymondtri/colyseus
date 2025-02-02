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

  public metadata: { [field: string]: number | string | boolean } = {};

  roomSchema: string[];
  roomProperties: { [field: string]: any } = {};

  #client: Pool;
  #roomTableName: string;
  #eligibleForMatchmaking: eligibleForMatchmakingCallback;

  removed: boolean = false;

  constructor(
    roomProperties: { [field: string]: any },
    roomSchema: string[],
    roomTableName: string,
    client: Pool,
    eligibleForMatchmaking: eligibleForMatchmakingCallback
  ) {
    this.#eligibleForMatchmaking = eligibleForMatchmaking;
    this.#client = client;
    this.#roomTableName = roomTableName;
    this.roomSchema = roomSchema;

    this.createdAt = (roomProperties && roomProperties.created_at)
      ? new Date(roomProperties.created_at)
      : new Date();

    Object.keys(roomProperties).forEach((field) => {
      if(field === 'eligibleForMatchmaking') return;

      if(field === 'roomId') {
        this.roomId = roomProperties[field];
        return;
      }

      if(this.roomSchema.includes(field)) {
        this[field] = roomProperties[field];
      } else {
        this.metadata[field] = roomProperties[field];

        // then we dynamically build a getter and setter
        Object.defineProperty(this, field, {
          get: () => this.metadata[field],
          set: (value) => this.metadata[field] = value
        })
      }
    })
  }

  get eligibleForMatchmaking(){
    return this.#eligibleForMatchmaking(this);
  }

  set eligibleForMatchmaking(value: boolean){ // do nothing
    return;
  }

  public async save(){
    if (this.removed) return;
    if (!this.roomId) {
      logger.error("PostgresqlDriver: RoomData.save() - roomId is required.");
      return;
    }

    const payload:{ [field: string]: boolean | string | number | Date } = {
      id: this.roomId,
      processId: this.processId,
      name: this.name,
      clients: this.clients,
      maxClients: this.maxClients,
      locked: this.locked,
      unlisted: this.unlisted,
      private: this.private,
      eligibleForMatchmaking: this.eligibleForMatchmaking,
      createdAt: this.createdAt,
      metadata: JSON.stringify(this.metadata)
    }

    // insert into room table

    const client = await this.#client.connect();

    const { rowCount } = await client.query(`
      INSERT INTO ${this.#roomTableName} ("${Object.keys(payload).join('","')}")
      VALUES (${Object.values(payload).map((value, i) => `$${i + 1}`).join(',')});
    `, Object.values(payload));

    client.release();

    if(rowCount === 0){
      logger.error("PostgresDriver: failed to save room data");
    }

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
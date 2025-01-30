import { MatchMakerDriver } from "@colyseus/core";
import { hrtime } from "process";

export class Queue {

  private _driver: MatchMakerDriver;

  constructor(driver: MatchMakerDriver) {
    this._driver = driver;

    if(this._driver.externalMatchmaker) throw new Error('External Matchmaking must be set to false on the matchmaker processor, it IS the external matchmaker.')
  }

  async process(){
    const startTime = hrtime.bigint();
    const eligibleRooms = await this._driver.query({eligibleForMatchmaking: true});
    const endTime = hrtime.bigint();
    console.log(eligibleRooms)

    const durationInMilliseconds = Number(endTime - startTime) / 1_000_000;
    console.log(`Found and deserialized ${eligibleRooms.length} eligible rooms in ${durationInMilliseconds} milliseconds.`)

    // TODO query the actual queue for requests to process

    // TODO matchmake the requests
  }

  async healthcheck(){
    // TODO another process that will check the health of all rooms and make sure there are no orphans from crashed rooms
  }

  async queue(...args:any){
    // TODO add a room to the queue
  }
}
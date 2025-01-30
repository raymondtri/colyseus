import nanoid from 'nanoid';
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

    const durationInMilliseconds = Number(endTime - startTime) / 1_000_000;
    console.log(`Found and deserialized ${eligibleRooms.length} eligible rooms in ${durationInMilliseconds} milliseconds.`)

    // console.log(eligibleRooms)

    // TODO query the actual queue for requests to process

    // TODO matchmake the requests
  }

  // we don't want a healthcheck in here
  // really if you are deploying via containers you want to have a cleanup process that fires if the container dies
  // so that should be a custom lambda

  async queue(...args:any){
    const requestId = nanoid(9);

    let connectionResolve;
    let connectionReject;
    const promise = new Promise((resolve, reject) => {
      connectionResolve = resolve;
      connectionReject = reject;
    })

    if(!this._driver.client) connectionReject('No client available to queue the request');

    this._driver.client.subscribe(`matchmaking:matches:${requestId}`);
    this._driver.client.on("message", (channel, message) => {
      // TODO return the response at this point
      console.log(channel)
      console.log(message)

      connectionResolve(message)
    })

    this._driver.client.sadd(`matchmaking:requests`, requestId);

    return promise;
  }
}
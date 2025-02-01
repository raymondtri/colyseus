import nanoid from 'nanoid';
import { matchMaker, MatchMakerDriver, AuthContext } from "@colyseus/core";
import { hrtime } from "process";

export type requestResponse = {
  roomName: string
  method: string
  options: matchMaker.ClientOptions
  settings: {
    hostname: string
    secure: boolean
    pathname: string | undefined
    port: number | undefined
  }
}

export class Queue {

  private _driver: MatchMakerDriver;

  public readonly targetRoomsPerProcess: number = 10;
  public readonly processFilterConditions: { [field: string]: any } = {};
  public readonly roomMaxClientMap: { [roomName: string]: number } = {};

  constructor(driver: MatchMakerDriver,  options?: any){
    this._driver = driver;

    if(this._driver.externalMatchmaker) throw new Error('External Matchmaking must be set to false on the matchmaker processor, it IS the external matchmaker.')

    if(options?.targetRoomsPerProcess) this.targetRoomsPerProcess = options.targetRoomsPerProcess;
    if(options?.processFilterConditions) this.processFilterConditions = options.processFilterConditions;
    if(options?.roomMaxClientMap) this.roomMaxClientMap = options.roomMaxClientMap;
  }

  // so this process function in all reality likely should be the onus of the game creator to operate
  // in fact I think a better pattern would be to publish this in a template after cleaning up
  // since to handle concurrent joinOrCreate you have to "synthetically" create a room
  // and that process of synthetically creating a room can result in nearly any outcome
  // so just having a default here that relies on max clients seems far better
  // maybe we pass in the static MyRoom objects and pull max clients off of that etc.
  // but yeah for concurrent matchmaking, I think you should have to write your own process and pass it in here
  // or just handle this yourself

  async process(){
    const startTime = hrtime.bigint();
    const endTime = hrtime.bigint();
    const durationInMilliseconds = Number(endTime - startTime) / 1_000_000;

    // console.log(`Found and deserialized ${eligibleRooms.length} eligible rooms in ${durationInMilliseconds} milliseconds.`)

    // let's get the requests
    const requests = await this._driver.spliceMatchmakingRequests();
    console.log(requests)

    // now we need to get all of the rooms that are eligible for matchmaking
    const eligibleRooms = await this._driver.query({eligibleForMatchmaking: true});
    console.log(eligibleRooms)
    // so now we have all of the rooms that are eligible for matchmaking

    const roomMap: { [roomId: string]: any } = {};
    eligibleRooms.forEach((room:any) => {
      roomMap[room.roomId] = room;
    })

    const findRoominEligibleRooms = (conditions: any) => {
      return Object.entries(roomMap).filter(([roomId, room]) => {
        if (!room) return false;
        if (room.clients >= room.maxClients) return false;

        for (const field in conditions) {
          if (
            conditions.hasOwnProperty(field) &&
            room[field] !== conditions[field]
          ) {
            return false;
          }
        }
        return true;
      }).map(([roomId, room]) => room);
    }

    // and now we need to get the processes ranked by eligibility
    const processes = await this._driver.queryProcesses(this.processFilterConditions,requests.length);
    console.log(processes)

    const processMap: { [processId: string]: any } = {};

    processes.forEach((process:any) => {
      processMap[process.processId] = process;
    })

    // how do we compare other process information? I really don't know, but for now here's the scors
    const findProcessinEligibleProcesses = (conditions: any) => {
      return Object.entries(processMap).filter(([processId, process]) => {
        if (!process) return false;
        for (const field in conditions) {
          if (
            conditions.hasOwnProperty(field) &&
            process[field] !== conditions[field]
          ) {
            return false;
          }
        }
        return true;
      }).sort((a, b) => {
        return a[1].score - b[1].score;
      }).map(([processId, process]) => process);
    }

    // TODO matchmake the requests

    // the processes are pre-scored / sorted by their own eligibility based on the rooms and clients they already contain
    // however we now need a second score here so that processes are assessed based on
    // the actual room requests that are coming in

    const promises: Promise<any>[] = [];

    requests.forEach((request:any) => {
      if(request.method === 'joinOrCreate'){
        // first we try to find an existing room that matches the criteria
        const room = findRoominEligibleRooms({name: request.roomName, ...request.clientOptions})[0];

        if(room){
          const url = new URL('http://' + room.publicAddress);

          const match = {
            method: 'join',
            roomName: request.roomName,
            options: request.clientOptions,
            settings: {
              hostname: url.hostname,
              secure: false, // TODO handle how we determine security
              pathname: url.pathname,
              port: url.port ? parseInt(url.port) : undefined
            }
          }

          // increment the room client count
          roomMap[room.roomId].clients += 1;

          // and then we dispatch it
          const pubd = this._driver.client.publish(`matchmaking:matches:${request.requestId}`, JSON.stringify(match));
          promises.push(pubd)
        } else {
          const process = findProcessinEligibleProcesses({})[0];
          const url = new URL('http://' + process.publicAddress);

          const match = {
            method: 'create',
            roomName: request.roomName,
            options: request.clientOptions,
            settings: {
              hostname: url.hostname,
              secure: false, // TODO handle how we determine security
              pathname: url.pathname,
              port: url.port ? parseInt(url.port) : undefined
            }
          }

          roomMap[nanoid(9)] = {
            clients: 1,
            maxClients: this.roomMaxClientMap[request.roomName] || 4,
            name: request.roomName,
            publicAddress: process.publicAddress,
            processId: process.processId,
            eligibleForMatchmaking: true,
          }
          processMap[process.processId].score += 1;

          // and then we dispatch it
          const pubd = this._driver.client.publish(`matchmaking:matches:${request.requestId}`, JSON.stringify(match));
          promises.push(pubd);
        }
      } else if (request.method === 'join') {
        const room = findRoominEligibleRooms({name: request.roomName, ...request.clientOptions})[0];

        if(room){
          const url = new URL('http://' + room.publicAddress);

          const match = {
            method: 'join',
            roomName: request.roomName,
            options: request.clientOptions,
            settings: {
              hostname: url.hostname,
              secure: false, // TODO handle how we determine security
              pathname: url.pathname,
              port: url.port ? parseInt(url.port) : undefined
            }
          }

          // increment the room client count
          roomMap[room.roomId].clients += 1;

          // and the processid client count
          processMap[room.processId].score += 1;

          // and then we dispatch it
          const pubd = this._driver.client.publish(`matchmaking:matches:${request.requestId}`, JSON.stringify(match));
          promises.push(pubd);
        }
      }
    })

    await Promise.all(promises);

    // phew

  }

  get queueableMethods(){
    return ['joinOrCreate', 'join']
  }

  get dispatchableMethods(){ // create should NEVER be queueable because then we have lots of weird room data issues
    return ['joinById', 'reconnect', 'create'];
  }

  // FIRST BOTTLENECK - number of connected clients to the redis instance. If 10,000 by default then this will only handle 9999 concurrent matchmaking requests
  // if you go over that threshold, then you will probably need to run a redis cluster
  // you will also need bigger nanoid lol
  waitForResponse(...args:any){
    const requestId = args.requestId || nanoid(9);

    let connectionResolve;
    let connectionReject;
    const promise = new Promise((resolve, reject) => {
      connectionResolve = resolve;
      connectionReject = reject;
    })

    if(!this._driver.client) connectionReject('No client available to queue the request');

    this._driver.client.subscribe(`matchmaking:matches:${requestId}`);
    this._driver.client.on("message", (channel, message) => {
      console.log(channel)
      console.log(message)

      this._driver.client.unsubscribe(`matchmaking:matches:${requestId}`);

      connectionResolve(message)
    })

    return promise;
  }

  // we don't want a healthcheck in here
  // really if you are deploying via containers you want to have a cleanup process that fires if the container dies
  // so that should be a custom lambda

  async queue(method:string, roomNameOrID:string, clientOptions:matchMaker.ClientOptions, authOptions?:AuthContext){
    if(!this.queueableMethods.includes(method)) throw new Error(`Method ${method} is not queueable.`);

    const requestId = nanoid(9);

    const args:any = {
      roomName: roomNameOrID,
      method,
      clientOptions,
      authOptions
    }

    this._driver.client.sadd(`matchmaking:requests`, JSON.stringify({
      ...args,
      requestId
    }));

    return this.waitForResponse(args);
  }

  async dispatch(method: string, roomNameOrID: string, clientOptions: matchMaker.ClientOptions, authOptions?: AuthContext){

    if(!this.dispatchableMethods.includes(method)) throw new Error(`Method ${method} is not dispatchable.`);

    const args:any = {
      roomName: roomNameOrID,
      method,
      clientOptions,
      authOptions
    }

    // if we purely dispatch create, we need to find which process to create the room in
    // we can do this naively by just grabbing a random eligible room
    if(method === 'create'){
      const process = (await this._driver.queryProcesses(this.processFilterConditions, 1))[0];

      console.log(process)

      if(!process) throw new Error('No process found to create room in.');

      const url = new URL('http://' + process.publicAddress);

      return {
        roomName: roomNameOrID,
        method: 'create',
        options: clientOptions,
        settings: {
          hostname: url.hostname,
          secure: false,
          pathname: url.pathname,
          port: url.port ? parseInt(url.port) : undefined
        }
      }
    } else {
      const room = (await this._driver.query({roomId: roomNameOrID}))[0];

      if(!room) throw new Error(`No room found for room ${roomNameOrID}`);

      const url = new URL('http://' + room.publicAddress);

      return {
        roomName: roomNameOrID,
        method,
        options: clientOptions,
        settings: {
          hostname: url.hostname,
          secure: false,
          pathname: url.pathname,
          port: url.port ? parseInt(url.port) : undefined
        }
      }
    }
  }

  async invokeMethod(method: string, roomNameOrID: string, clientOptions: matchMaker.ClientOptions, authOptions?: AuthContext){
    if(this.queueableMethods.includes(method)){
      return this.queue(method, roomNameOrID, clientOptions, authOptions);
    } else {
      return this.dispatch(method, roomNameOrID, clientOptions, authOptions);
    }
  }


}
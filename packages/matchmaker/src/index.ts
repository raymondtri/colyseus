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

  public readonly queueCreate: boolean = false;
  public readonly targetRoomsPerProcess: number = 10;
  public readonly processFilterConditions: { [field: string]: any } = {};

  constructor(driver: MatchMakerDriver,  options?: any){
    this._driver = driver;

    if(this._driver.externalMatchmaker) throw new Error('External Matchmaking must be set to false on the matchmaker processor, it IS the external matchmaker.')

    if(options?.queueCreate) this.queueCreate = true;
    if(options?.targetRoomsPerProcess) this.targetRoomsPerProcess = options.targetRoomsPerProcess;
    if(options?.processFilterConditions) this.processFilterConditions = options.processFilterConditions
  }

  async process(){
    const startTime = hrtime.bigint();
    // first we need to get all of the rooms that are eligible for matchmaking
    const eligibleRooms = await this._driver.query({eligibleForMatchmaking: true});
    const endTime = hrtime.bigint();

    const durationInMilliseconds = Number(endTime - startTime) / 1_000_000;
    console.log(`Found and deserialized ${eligibleRooms.length} eligible rooms in ${durationInMilliseconds} milliseconds.`)

    // console.log(eligibleRooms)
    // so now we have all of the rooms that are eligible for matchmaking

    // let's get the requests
    const requests = await this._driver.spliceMatchmakingRequests();
    console.log(requests)
    // and now we have all of the requests that need to be made

    // and now we need to get the processes ranked by eligibility
    const processes = await this._driver.queryProcesses(this.processFilterConditions,requests.length);
    console.log(processes)

    const processMap: { [processId: string]: any } = {};

    processes.forEach((process:any) => {
      processMap[process.processId] = process;
    })

    // how do we compare other process information? I really don't know, but for now here's the scors
    const findProcessinEligibleProcesses = (conditions: any) => {
      return processes.filter((process:any) => {
        for (const field in conditions) {
          if (
            conditions.hasOwnProperty(field) &&
            process[field] !== conditions[field]
          ) {
            return false;
          }
        }
        return true;
      }).sort((a:any, b:any) => {
        return a.score - b.score;
      })
    }

    // TODO matchmake the requests

    // the processes are pre-scored / sorted by their own eligibility based on the rooms and clients they already contain
    // however we now need a second score here so that processes are assessed based on
    // the actual room requests that are coming in

    const creates: requestResponse[] = [];

    /*
    const findRoomInEligibleRooms = (roomName:string, conditions: any) => {
      const oldRooms = eligibleRooms.filter((room:any) => {
        if(room.roomName !== roomName) return false;

        for (const field in conditions) {
          if (
            conditions.hasOwnProperty(field) &&
            room[field] !== conditions[field]
          ) {
            return false;
          }
        }
        return true;
      })

      const newRooms = creates.filter((room:any) => {
        for (const field in conditions) {
          if (
            conditions.hasOwnProperty(field) &&
          )
        }
      })
    }
    */

    // I think we have to loop the requests multiple times which is gross but whatever
    // this is more proof of concept than production ready
    // 1. match up any creates with any processes that are eligible
    requests.forEach((request:any) => {
      if(request.method === 'create'){ // we just automatically handle these
        const process = findProcessinEligibleProcesses({})[0];
        const url = new URL(process.publicAddress);

        const match = {
          method: 'create',
          roomName: request.roomName,
          options: request.clientOptions,
          settings: {
            hostname: url.hostname,
            secure: url.protocol === 'https:' || url.protocol === 'wss:',
            pathname: url.pathname,
            port: url.port ? parseInt(url.port) : undefined
          }
        }

        creates.push(match);

        // increment the score here? again, I really don't know, this all feels so custom based on the individual game use case
        // I really think this whole process piece gets exposed for people to define themself but it's just a part of the template
        processMap[process.processId].score += 1;

        // and then we dispatch it
        this._driver.client.publish(`matchmaking:matches:${request.requestId}`, JSON.stringify(match));
      }
    })

    // 2. now we match up any joinOrCreates


    // 2. match up any joins with any rooms that already match the criteria
    // 3. handle the joinOrCreates, since we can basically transmute them into a join or a create

    // instead of touching the end server directly, because then this could need to handle tens of thousands of open http connections
    // we should return a response to the client that they should reconnect to the server that is handling their room
    // and then we need to correct the joinOrCreate to be a join or a create based on the logic ran above


    /*
    const response = {
      method: 'create',
      roomName: 'test',
      options: {},
      settings: { // you must return settings so the client can recalibrate
        hostname: 'localhost',
        secure: false,
        pathname: undefined,
        port: undefined
      }
    }

    if(response.method === 'joinOrCreate'){
      throw new Error("You cannot return a joinOrCreate response from the matchmaker processor. You must return a join or a create.")
    }
    */

    // this._driver.client.publish(`matchmaking:matches:${requestId}`, JSON.stringify(response));
  }

  get queueableMethods(){
    return ['joinOrCreate', 'join'].concat(this.queueCreate ? ['create'] : []);
  }

  get dispatchableMethods(){
    return ['joinById', 'reconnect'].concat(this.queueCreate ? [] : ['create']);
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

      const url = new URL(process.publicAddress);

      return {
        roomName: roomNameOrID,
        method: 'create',
        options: clientOptions,
        settings: {
          hostname: url.hostname,
          secure: url.protocol === 'https:' || url.protocol === 'wss:',
          pathname: url.pathname,
          port: url.port ? parseInt(url.port) : undefined
        }
      }
    } else {
      const room = (await this._driver.query({roomId: roomNameOrID}))[0];

      if(!room) throw new Error(`No room found for room ${roomNameOrID}`);

      const url = new URL(room.publicAddress);

      return {
        roomName: roomNameOrID,
        method,
        options: clientOptions,
        settings: {
          hostname: url.hostname,
          secure: url.protocol === 'https:' || url.protocol === 'wss:',
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
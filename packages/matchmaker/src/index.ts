import nanoid from 'nanoid';
import { matchMaker, MatchMakerDriver, AuthContext } from "@colyseus/core";

export class Queue {

  driver: MatchMakerDriver;

  public readonly queueCreate: boolean = false;
  public readonly targetRoomsPerProcess: number = 10;

  constructor(driver: MatchMakerDriver,  options?: any){
    this.driver = driver;

    if(this.driver.externalMatchmaker) throw new Error('External Matchmaking must be set to false on the matchmaker processor, it IS the external matchmaker.')

    if(options?.queueCreate) this.queueCreate = true;
    if(options?.targetRoomsPerProcess) this.targetRoomsPerProcess = options.targetRoomsPerProcess;
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

    if(!this.driver.client) connectionReject('No client available to queue the request');

    this.driver.client.subscribe(`matchmaking:matches:${requestId}`);
    this.driver.client.on("message", (channel, message) => {
      console.log(channel)
      console.log(message)

      this.driver.client.unsubscribe(`matchmaking:matches:${requestId}`);

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

    this.driver.client.sadd(`matchmaking:requests`, JSON.stringify({
      ...args,
      requestId
    }));

    return this.waitForResponse(args);
  }

  async dispatch(method: string, roomNameOrID: string, clientOptions: matchMaker.ClientOptions, authOptions?: AuthContext){

    if(!this.dispatchableMethods.includes(method)) throw new Error(`Method ${method} is not dispatchable.`);

    let processId:string;

    const args:any = {
      roomName: roomNameOrID,
      method,
      clientOptions,
      authOptions
    }

    // if we purely dispatch create, we need to find which process to create the room in
    // we can do this naively by just grabbing a random eligible room
    if(method === 'create'){
      processId = await this.driver.findProcessesForMatchmaking(1)[0];
    } else {
      processId = (await this.driver.query({roomId: roomNameOrID}))[0]?.processId;
    }

    if(!processId) throw new Error(`No process found for room ${roomNameOrID}`);

    const promise = this.waitForResponse(args);

    await this.driver.client.publish(`matchmaking:methods:${processId}`, JSON.stringify(args));

    return promise;
  }

  async invokeMethod(method: string, roomNameOrID: string, clientOptions: matchMaker.ClientOptions, authOptions?: AuthContext){
    if(this.queueableMethods.includes(method)){
      return this.queue(method, roomNameOrID, clientOptions, authOptions);
    } else {
      return this.dispatch(method, roomNameOrID, clientOptions, authOptions);
    }
  }


}
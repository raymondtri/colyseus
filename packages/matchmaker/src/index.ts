import { MatchMakerDriver } from "@colyseus/core";

export type ClientOptions = any;

export let driver: MatchMakerDriver
export let maxClients = Infinity;

export async function setup(
  driver: MatchMakerDriver,
  options: {
    maxClients?: number
  } = {}
) {
  this.driver = driver;
  driver.externalMatchmaker = false; // this is just a clarity thing but is necessary

  if(options.maxClients){
    this.maxClients = options.maxClients;
  }
}



export async function joinById(roomId: string, clientOptions: ClientOptions = {}){

}

export async function reconnect(roomId: string, sessionId: string, clientOptions: ClientOptions = {}){

}


// both rooms by processId AND clients by processId are important
// create, join and joinOrCreate are very advanced because you need to queue up the room creation so that it will create a room with matching clients
export async function create(roomName: string, clientOptions: ClientOptions = {}){
  // we have a couple of steps here
  // 1. we need to find the process that is most suitable for the room, this is based on
  //   a. the number of clients in the process which is derived from
  //     i. the number of clients in each room of the process



}

export async function joinOrCreate(roomName: string, clientOptions: ClientOptions = {}){

}

export async function join(roomName: string, clientOptions: ClientOptions = {}){

}

export async function clientsByProcessId(){

}

import { MatchMakerDriver } from "@colyseus/core";

export type ClientOptions = any;

export let driver: MatchMakerDriver

export async function setup(
  driver: MatchMakerDriver
) {
  this.driver = driver;
  driver.externalMatchmaker = false; // this is just a clarity thing but is necessary
}

export async function create(roomName: string, clientOptions: ClientOptions = {}){
  const processesByClients = driver.client.zrangebyscore(`${driver.roomCachesKey}:clientsUnlockedAndPublic`,)
}

export async function joinById(roomId: string, clientOptions: ClientOptions = {}){

}

export async function reconnect(roomId: string, sessionId: string, clientOptions: ClientOptions = {}){

}

// join and joinOrCreate are very advanced because you need to queue up the room creation so that it will create a room with matching clients
export async function joinOrCreate(roomName: string, clientOptions: ClientOptions = {}){

}

export async function join(roomName: string, clientOptions: ClientOptions = {}){

}
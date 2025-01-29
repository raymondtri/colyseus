import { RoomData } from "./RoomData";

export type eligibleForMatchmakingCallback = (room: RoomData) => boolean;

export const eligibleForMatchmaking = (room: RoomData) => !room.locked && !room.private && !room.unlisted && room.clients < room.maxClients;
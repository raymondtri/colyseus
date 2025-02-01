import { RoomData } from "./RoomData";

export type eligibleForMatchmakingCallback = (room: RoomData) => boolean;

export const eligibleForMatchmaking = (room: RoomData) => !room.locked && !room.private && !room.unlisted && room.clients < room.maxClients;

// LOWER IS BETTER
export type processEligibilityScoreCallback = (room: RoomData) => number;

export type processEligibilityScoreCallbackMap = { [roomName: string]: processEligibilityScoreCallback };

export const processEligibilityScore = (room: RoomData) => room.clients;
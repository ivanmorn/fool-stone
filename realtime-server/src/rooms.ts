import { Room, RoomCode, Player, Snapshot } from "./types.js";

const rooms = new Map<RoomCode, Room>();

export function genRoomCode(): RoomCode {
  // 1000 - 9999
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  throw new Error("No room code available");
}

export function createRoom(hostSocketId: string, sessionId: string, name: string, maxPlayers = 5): Room {
  const code = genRoomCode();
  const room: Room = {
    code,
    hostSocketId,
    players: [{
      id: "P1",
      name,
      sessionId,
      isHost: true,
      online: true,
    }],
    snapshot: null,
    version: 0,
    createdAt: Date.now(),
    maxPlayers,
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: RoomCode): Room | undefined {
  return rooms.get(code);
}

export function deleteRoom(code: RoomCode) {
  rooms.delete(code);
}

export function joinRoom(code: RoomCode, sessionId: string, name: string): {room: Room, player: Player} {
  const room = rooms.get(code);
  if (!room) throw new Error("Room not found");

  // 重连优先：有同 sessionId 的玩家，直接标记 online
  const old = room.players.find(p => p.sessionId === sessionId);
  if (old) {
    old.online = true;
    return { room, player: old };
  }

  if (room.players.length >= room.maxPlayers) throw new Error("Room full");

  const pid = "P" + (room.players.length + 1);
  const player: Player = { id: pid, name, sessionId, isHost: false, online: true };
  room.players.push(player);
  return { room, player };
}

export function markOfflineBySocket(code: RoomCode, socketId: string) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.hostSocketId === socketId) {
    // 房主掉线：不删房，标记 host offline，但保留房间，等房主或其他设备重连/移交
    room.hostSocketId = null;
  }
}

export function setHostSocket(code: RoomCode, socketId: string) {
  const room = rooms.get(code);
  if (!room) return;
  room.hostSocketId = socketId;
}

export function updateSnapshot(code: RoomCode, snapshot: Snapshot, version: number) {
  const room = rooms.get(code);
  if (!room) return;
  // 简单防乱序：只接受更大的版本
  if (version > room.version) {
    room.snapshot = snapshot;
    room.version = version;
  }
}

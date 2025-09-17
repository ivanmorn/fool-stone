// src/realtime/socket.ts
import { io, Socket } from "socket.io-client";
import type { GameSnapshot } from "../types";

export type IntentMsg = { action: string; payload?: unknown; from: string; room: string };
export type PresenceUser = { id: string; name: string; sessionId: string; seat: number; isHost?: boolean };
export type PresenceState = { roomCode: string | null; users: PresenceUser[] };
export type StateSnapshotMsg = { snapshot: GameSnapshot; from: string; at?: number; target?: string };
export type StateRequestMsg = { room: string; from: string };

type RTState = {
  roomCode: string | null;
  isHost: boolean;
};

let socket: Socket | null = null;
const state: RTState = { roomCode: null, isHost: false };
let presenceState: PresenceState | null = null;
const intentSubs: Array<(msg: IntentMsg) => void> = [];
const presenceSubs: Array<(state: PresenceState | null) => void> = [];
const stateSubs: Array<(msg: StateSnapshotMsg) => void> = [];
const stateRequestSubs: Array<(msg: StateRequestMsg) => void> = [];

function resolveRtUrl() {
  const env = import.meta.env.VITE_RT_URL;
  if (env) return env;
  const u = new URL(location.href);
  u.port = "8787";
  return u.origin;
}

export function getSessionId(): string {
  let sid = localStorage.getItem("sessionId");
  if (!sid) {
    const uuid =
      (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined) ??
      `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sid = uuid;
    localStorage.setItem("sessionId", sid);
  }
  return sid;
}

function ensureSocket(): Socket {
  if (socket) return socket;
  socket = io(resolveRtUrl(), { transports: ["websocket"] });

  // 服务器只发给房主的意图
  socket.on("intent", (msg: { action: string; data?: unknown; from: string; room: string }) => {
    for (const fn of intentSubs) fn({ action: msg.action, payload: msg.data, from: msg.from, room: msg.room });
  });

  socket.on("state:full", (msg: { snapshot: GameSnapshot; from: string; at?: number; target?: string }) => {
    for (const fn of stateSubs) fn({ snapshot: msg.snapshot, from: msg.from, at: msg.at, target: msg.target });
  });

  socket.on("state:request", (msg: { room: string; from: string }) => {
    for (const fn of stateRequestSubs) fn({ room: msg.room, from: msg.from });
  });

  // 在场名单更新 → 记录房间/房主
  socket.on("presence:state", (p: { roomCode: string; users: PresenceUser[] }) => {
    const me = p.users.find(u => u.sessionId === getSessionId());
    state.roomCode = p.roomCode ?? null;
    state.isHost = !!me?.isHost;
    // 小备份，调试用
    localStorage.setItem("lastRoomCode", (state.roomCode ?? ""));
    localStorage.setItem("isHost", state.isHost ? "1" : "0");

    presenceState = {
      roomCode: p.roomCode ?? null,
      users: Array.isArray(p.users) ? [...p.users] : [],
    };
    const snapshot = presenceState
      ? { roomCode: presenceState.roomCode, users: [...presenceState.users] }
      : null;
    for (const fn of presenceSubs) fn(snapshot);
  });

  return socket;
}

export function emitAck<T = unknown, R = unknown>(
  event: string,
  data?: T,
  timeoutMs = 8000
): Promise<R> {
  return new Promise((resolve, reject) => {
    const s = ensureSocket();
    const to = setTimeout(() => reject(new Error("Ack timeout")), timeoutMs);
    const payload = (data ?? {}) as T;
    s.emit(event, payload, (resp: R) => {
      clearTimeout(to);
      resolve(resp);
    });
  });
}

/** 非房主把意图发给房主 */
function sendIntent(action: string, payload?: unknown) {
  if (!state.roomCode) return;
  return emitAck("intent", {
    room: state.roomCode!,        // 这里已做非空判断，使用 !
    action,
    data: payload,
    from: getSessionId(),
  });
}

function subscribeIntent(handler: (msg: IntentMsg) => void) {
  intentSubs.push(handler);
  return () => {
    const i = intentSubs.indexOf(handler);
    if (i >= 0) intentSubs.splice(i, 1);
  };
}

function subscribeState(handler: (msg: StateSnapshotMsg) => void) {
  stateSubs.push(handler);
  return () => {
    const i = stateSubs.indexOf(handler);
    if (i >= 0) stateSubs.splice(i, 1);
  };
}

function subscribeStateRequest(handler: (msg: StateRequestMsg) => void) {
  stateRequestSubs.push(handler);
  return () => {
    const i = stateRequestSubs.indexOf(handler);
    if (i >= 0) stateRequestSubs.splice(i, 1);
  };
}

function subscribePresence(handler: (state: PresenceState | null) => void) {
  presenceSubs.push(handler);
  return () => {
    const i = presenceSubs.indexOf(handler);
    if (i >= 0) presenceSubs.splice(i, 1);
  };
}

function getPresence(): PresenceState | null {
  if (!presenceState) return null;
  return { roomCode: presenceState.roomCode, users: [...presenceState.users] };
}

function getRoom() {
  return state.roomCode as string | null;
}
function getIsHost() {
  return state.isHost;
}

function sendState(snapshot: GameSnapshot, targetSessionId?: string) {
  if (!state.roomCode) return;
  return emitAck("state:full", {
    room: state.roomCode!,
    snapshot,
    from: getSessionId(),
    target: targetSessionId,
  });
}

function requestState() {
  if (!state.roomCode) return;
  return emitAck("state:request", {
    room: state.roomCode!,
    from: getSessionId(),
  });
}

export const rt = {
  getSocket: ensureSocket,
  emitAck,
  sendIntent,
  subscribeIntent,
  subscribeState,
  subscribeStateRequest,
  subscribePresence,
  sendState,
  requestState,
  getPresence,
  getRoom,
  isHost: getIsHost,
};

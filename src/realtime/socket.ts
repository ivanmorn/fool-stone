// src/realtime/socket.ts
import { io, Socket } from "socket.io-client";
import type { GameSnapshot } from "../types";

/** ===== 类型 ===== */
export type IntentMsg = { action: string; payload?: unknown; from: string; room: string };
export type PresenceUser = { id: string; name: string; sessionId: string; seat: number; isHost?: boolean };
export type PresenceState = { roomCode: string | null; users: PresenceUser[] };
export type StateSnapshotMsg = { snapshot: GameSnapshot; from: string; at?: number; target?: string };
export type StateRequestMsg = { room: string; from: string };

type RTState = {
  roomCode: string | null;
  isHost: boolean;
};

/** ===== 内部状态 ===== */
let socket: Socket | null = null;
const state: RTState = { roomCode: null, isHost: false };
let presenceState: PresenceState | null = null;

const intentSubs: Array<(msg: IntentMsg) => void> = [];
const presenceSubs: Array<(state: PresenceState | null) => void> = [];
const stateSubs: Array<(msg: StateSnapshotMsg) => void> = [];
const stateRequestSubs: Array<(msg: StateRequestMsg) => void> = [];

// 连接状态订阅
let _connected = false;
const connSubs: Array<(ok: boolean) => void> = [];
function notifyConn(ok: boolean) {
  _connected = ok;
  for (const fn of connSubs) fn(ok);
}
export function onConnection(cb: (ok: boolean) => void) {
  connSubs.push(cb);
  cb(_connected);
  return () => {
    const i = connSubs.indexOf(cb);
    if (i >= 0) connSubs.splice(i, 1);
  };
}
export function isConnected() { return _connected; }

/** ===== 工具：实时服务器 URL 解析 ===== */
function resolveRtUrl() {
  // 优先使用 Vite 注入的环境变量（示例：wss://fool-stone-realtime.onrender.com）
  const env = import.meta.env.VITE_RT_URL;
  if (env) return env;

  // 兜底：同域同协议
  const isHttps = location.protocol === "https:";
  const proto = isHttps ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

/** ===== 会话 ID（断线重连用） ===== */
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

/** ===== 建立（或复用）Socket 连接 ===== */
function ensureSocket(): Socket {
  if (socket) return socket;

  // 先创建到局部变量，再赋给全局的 socket
  const s: Socket = io(resolveRtUrl(), {
    transports: ["websocket"],
    withCredentials: true,
  });
  socket = s;

  // 连接状态
  s.on("connect", () => {
    console.log("[realtime] connected:", s.id);
    notifyConn(true);
  });
  s.on("disconnect", (reason) => {
    console.log("[realtime] disconnected:", reason);
    notifyConn(false);
  });
  s.on("connect_error", (err) => {
    console.error("[realtime] connect_error:", err.message);
    notifyConn(false);
  });
  s.io.on("reconnect_attempt", () => { notifyConn(false); });

  // 服务器只发给房主的意图
  s.on("intent", (msg: { action: string; data?: unknown; from: string; room: string }) => {
    for (const fn of intentSubs) fn({ action: msg.action, payload: msg.data, from: msg.from, room: msg.room });
  });

  // 完整快照
  s.on("state:full", (msg: { snapshot: GameSnapshot; from: string; at?: number; target?: string }) => {
    for (const fn of stateSubs) fn({ snapshot: msg.snapshot, from: msg.from, at: msg.at, target: msg.target });
  });

  // 主机请求你上传快照
  s.on("state:request", (msg: { room: string; from: string }) => {
    for (const fn of stateRequestSubs) fn({ room: msg.room, from: msg.from });
  });

  // 在场名单更新
  s.on("presence:state", (p: { roomCode: string; users: PresenceUser[] }) => {
    const me = p.users.find(u => u.sessionId === getSessionId());
    state.roomCode = p.roomCode ?? null;
    state.isHost = !!me?.isHost;

    localStorage.setItem("lastRoomCode", state.roomCode ?? "");
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

  return s;
}

/** ===== 通用 ACK 发送 ===== */
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

/** ===== 业务封装 ===== */

// 非房主把意图发给房主
function sendIntent(action: string, payload?: unknown) {
  if (!state.roomCode) return;
  return emitAck("intent", {
    room: state.roomCode!, // 已有非空判断
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

/** ===== 导出 API ===== */
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
export default rt;
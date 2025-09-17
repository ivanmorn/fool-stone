// realtime-server/src/index.ts
import express, { Request, Response } from "express";
import cors from "cors";
import http from "http";
import { Server, Socket } from "socket.io";
import type { Snapshot } from "./types.js";

/** ===== 简单内存房间状态 ===== */
type PresenceUser = {
  id: string;          // 服务器分配
  name: string;
  sessionId: string;   // 客户端持久化，用于断线重连
  seat: number;
  isHost?: boolean;
};

type Room = {
  code: string; // 四位数字
  users: Map<string, PresenceUser>; // key = sessionId
  hostSessionId: string;
  createdAt: number;
};

const rooms = new Map<string, Room>();
const MAX_SEATS = 5;

/** ===== 工具函数 ===== */
function randCode(): string {
  let c = "";
  while (c.length < 4) c = Math.floor(1000 + Math.random() * 9000).toString();
  return c;
}
function pickRoomCode(): string {
  let code = randCode();
  while (rooms.has(code)) code = randCode();
  return code;
}
function listUsers(r: Room): PresenceUser[] {
  return Array.from(r.users.values()).map(u => ({ ...u }));
}

function nextAvailableSeat(r: Room, preferred?: number): number | null {
  const occupied = new Set<number>();
  for (const u of r.users.values()) occupied.add(u.seat);
  if (preferred && preferred >= 1 && preferred <= MAX_SEATS && !occupied.has(preferred)) {
    return preferred;
  }
  for (let i = 1; i <= MAX_SEATS; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}

function refreshHostFlags(room: Room) {
  for (const [sid, user] of room.users.entries()) {
    room.users.set(sid, { ...user, isHost: sid === room.hostSessionId });
  }
}

/** ===== 基础服务 ===== */
const app = express();
app.use(cors());
app.get("/", (_: Request, res: Response) => {
  res.type("text/plain").send("Fool-Stone Realtime OK");
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/** ===== socket 连接 ===== */
io.on("connection", (socket: Socket) => {
  socket.data.roomCode = null as string | null;
  socket.data.sessionId = null as string | null;

  /** 创建房间 */
  socket.on(
    "room:create",
    (
      payload: { name: string; sessionId: string },
      cb: (resp: { ok: boolean; code?: string; users?: PresenceUser[]; me?: PresenceUser; msg?: string }) => void
    ) => {
      try {
        const { name, sessionId } = payload || {};
        if (!name || !sessionId) return cb({ ok: false, msg: "缺少 name 或 sessionId" });

        const code = pickRoomCode();
        const room: Room = {
          code,
          users: new Map(),
          hostSessionId: sessionId,
          createdAt: Date.now(),
        };

        const seat = nextAvailableSeat(room) ?? 1;
        const me: PresenceUser = {
          id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          name,
          sessionId,
          seat,
          isHost: true,
        };
        room.users.set(sessionId, me);
        refreshHostFlags(room);
        rooms.set(code, room);

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.sessionId = sessionId;

        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
        cb({ ok: true, code, users: listUsers(room), me });
      } catch {
        cb({ ok: false, msg: "room:create 失败" });
      }
    }
  );

  /** 加入房间 */
  socket.on(
    "room:join",
    (
      payload: { code: string; name: string; sessionId: string },
      cb: (resp: { ok: boolean; users?: PresenceUser[]; me?: PresenceUser; msg?: string }) => void
    ) => {
      try {
        const { code, name, sessionId } = payload || {};
        const room = code ? rooms.get(code) : undefined;
        if (!room) return cb({ ok: false, msg: "房间不存在" });
        if (!name || !sessionId) return cb({ ok: false, msg: "缺少 name 或 sessionId" });

        const existed = room.users.get(sessionId);
        const seat = existed?.seat ?? nextAvailableSeat(room);
        if (!seat) return cb({ ok: false, msg: "房间已满" });

        const me: PresenceUser = existed
          ? { ...existed, name, seat, isHost: sessionId === room.hostSessionId }
          : {
              id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
              name,
              sessionId,
              seat,
              isHost: sessionId === room.hostSessionId,
            };
        room.users.set(sessionId, me);
        refreshHostFlags(room);

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.sessionId = sessionId;

        io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
        cb({ ok: true, users: listUsers(room), me });
      } catch {
        cb({ ok: false, msg: "room:join 失败" });
      }
    }
  );

  /** 仅返回在场名单 */
  socket.on(
    "presence:list",
    (payload: { code: string }, cb: (resp: { ok: boolean; users?: PresenceUser[]; msg?: string }) => void) => {
      const { code } = payload || {};
      const room = code ? rooms.get(code) : undefined;
      if (!room) return cb({ ok: false, msg: "房间不存在" });
      cb({ ok: true, users: listUsers(room) });
    }
  );

  /**
   * ===== Phase 1：动作总线（房主权威） =====
   * 非房主发 “intent”，服务器只转发给房主；
   * 房主本地执行后，发 “action”，服务器广播给全房间。
   */

  // 非房主 -> 房主
  socket.on(
    "intent",
    (
      payload: { room: string; action: string; data?: unknown; from: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, action, data, from } = payload || {};
      const r = room ? rooms.get(room) : undefined;
      if (!r) return cb({ ok: false });

      // 找到房主的 socket 并单独发送
      const hostSessionId = r.hostSessionId;
      const roomSet = io.sockets.adapter.rooms.get(room);
      if (roomSet) {
        for (const sid of roomSet) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === hostSessionId) {
            s.emit("intent", { action, data, from, room });
          }
        }
      }
      cb({ ok: true });
    }
  );

  // 房主 -> 广播
  socket.on(
    "action",
    (
      payload: { room: string; action: string; data?: unknown; from: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, action, data, from } = payload || {};
      if (!room || !rooms.has(room)) return cb({ ok: false });
      io.to(room).emit("action", { action, payload: data, from, at: Date.now() });
      cb({ ok: true });
    }
  );

  // 客户端请求最新快照 -> 转给房主
  socket.on(
    "state:request",
    (
      payload: { room: string; from: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, from } = payload || {};
      const r = room ? rooms.get(room) : undefined;
      if (!r) return cb({ ok: false });

      const hostSessionId = r.hostSessionId;
      const roomSet = io.sockets.adapter.rooms.get(room);
      if (roomSet) {
        for (const sid of roomSet) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === hostSessionId) {
            s.emit("state:request", { room, from: from ?? socket.data.sessionId });
          }
        }
      }
      cb({ ok: true });
    }
  );

  // 房主广播快照
  socket.on(
    "state:full",
    (
      payload: { room: string; snapshot: Snapshot; from: string; target?: string },
      cb: (resp: { ok: boolean }) => void
    ) => {
      const { room, snapshot, from, target } = payload || {};
      const r = room ? rooms.get(room) : undefined;
      if (!r) return cb({ ok: false });
      if (socket.data.sessionId !== r.hostSessionId) return cb({ ok: false });

      if (target) {
        for (const sid of io.sockets.adapter.rooms.get(room) || []) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.sessionId === target) {
            s.emit("state:full", { snapshot, from, at: Date.now(), target });
          }
        }
      } else {
        io.to(room).emit("state:full", { snapshot, from, at: Date.now() });
      }
      cb({ ok: true });
    }
  );

  /** 关闭房间（仅房主） */
  socket.on(
    "room:close",
    (payload: { code: string }, cb: (resp: { ok: boolean }) => void) => {
      const { code } = payload || {};
      const room = code ? rooms.get(code) : undefined;
      if (!room) return cb({ ok: false });
      if (socket.data.sessionId !== room.hostSessionId) return cb({ ok: false });

      io.to(code).emit("room:closed", { code });
      io.socketsLeave(code);
      rooms.delete(code);
      cb({ ok: true });
    }
  );

  /** 断开清理 */
  socket.on("disconnect", () => {
    const code: string | null = socket.data.roomCode;
    const sessionId: string | null = socket.data.sessionId;
    if (!code || !sessionId) return;

    const room = rooms.get(code);
    if (!room) return;

    room.users.delete(sessionId);

    // 房主离开 → 让渡
    if (sessionId === room.hostSessionId) {
      const first = Array.from(room.users.values())[0];
      if (first) {
        room.hostSessionId = first.sessionId;
      }
    }

    refreshHostFlags(room);

    if (room.users.size === 0) {
      rooms.delete(code);
    } else {
      io.to(code).emit("presence:state", { roomCode: code, users: listUsers(room) });
    }
  });
});

/** ===== 启动 ===== */
const PORT = Number(process.env.PORT || 8787);
server.listen(PORT, () => {
  console.log(`Realtime server listening on ${PORT}`);
});

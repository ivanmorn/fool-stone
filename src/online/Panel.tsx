// src/online/Panel.tsx
import { useEffect, useState } from "react";
import rt, {
  onConnection,
  isConnected,
  getSessionId,
  type PresenceState,
} from "../realtime/socket";

type CreateReq = { name: string; sessionId: string };
type CreateResp = { ok: boolean; code?: string; msg?: string }; // 服务器返回的是 msg
type JoinReq = { code: string; name: string; sessionId: string };
type JoinResp = { ok: boolean; msg?: string };                  // 服务器返回的是 msg

export default function OnlinePanel() {
  // 连接状态：用 socket.ts 提供的订阅 API
  const [connected, setConnected] = useState<boolean>(isConnected());

  const [name, setName] = useState<string>(localStorage.getItem("name") || "");
  const [code, setCode] = useState<string>(localStorage.getItem("lastRoomCode") || "");
  const [creating, setCreating] = useState<boolean>(false);
  const [joining, setJoining] = useState<boolean>(false);
  const [presence, setPresence] = useState<PresenceState | null>(() => rt.getPresence());

  // 建立连接 & 订阅连接状态
  useEffect(() => {
    rt.getSocket(); // 页面挂载时发起连接
    const off = onConnection(setConnected);
    return off;
  }, []);

  // 订阅在场状态
  useEffect(() => {
    const off = rt.subscribePresence((state) => {
      setPresence(state);
      if (state?.roomCode) {
        localStorage.setItem("lastRoomCode", state.roomCode);
      }
    });
    return () => off();
  }, []);

  // 创建房间
  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const sessionId = getSessionId();
      const resp = await rt.emitAck<CreateReq, CreateResp>("room:create", { name, sessionId });
      if (resp?.ok && resp.code) {
        setCode(resp.code);
        localStorage.setItem("name", name);
        localStorage.setItem("lastRoomCode", resp.code);
        alert(`房间已创建：${resp.code}`);
      } else {
        alert(`创建失败：${resp?.msg ?? "未知原因"}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`创建失败：${message}`);
    } finally {
      setCreating(false);
    }
  }

  // 加入房间
  async function handleJoin() {
    const roomCode = code.trim();
    if (!name.trim() || roomCode.length !== 4) return;
    setJoining(true);
    try {
      const sessionId = getSessionId();
      const resp = await rt.emitAck<JoinReq, JoinResp>("room:join", { code: roomCode, name, sessionId });
      if (resp?.ok) {
        localStorage.setItem("name", name);
        localStorage.setItem("lastRoomCode", roomCode);
        alert(`已加入房间：${roomCode}`);
      } else {
        alert(`加入失败：${resp?.msg ?? "未知原因"}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`加入失败：${message}`);
    } finally {
      setJoining(false);
    }
  }

  // UI 辅助
  const players = presence?.users ?? [];
  const mySession = getSessionId();
  const seats = Array.from({ length: 5 }, (_, idx) => players.find(u => u.seat === idx + 1) ?? null);
  const missing = seats.filter(u => !u).length;

  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">
        连接：{connected ? "已连接" : "未连接"}
      </div>

      <div className="border-b pb-3 mb-3">
        <div className="text-sm font-medium mb-2">创建房间</div>
        <input
          className="border rounded px-2 py-1 w-full mb-2"
          placeholder="你的昵称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="w-full px-3 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={!connected || creating || !name.trim()}
          onClick={handleCreate}
        >
          {creating ? "创建中…" : "创建房间"}
        </button>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">加入房间</div>
        <input
          className="border rounded px-2 py-1 w-full mb-2"
          placeholder="房间号（四位数字）"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          maxLength={4}
        />
        <input
          className="border rounded px-2 py-1 w-full mb-2"
          placeholder="你的昵称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="w-full px-3 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={!connected || joining || !name.trim() || code.trim().length !== 4}
          onClick={handleJoin}
        >
          {joining ? "加入中…" : "加入房间"}
        </button>
      </div>

      {presence && (
        <div className="mt-4 border rounded p-3 bg-gray-50">
          <div className="text-xs text-gray-600 mb-2">
            房间 {presence.roomCode ?? "-"} ｜ 当前在线 {players.length}/5
          </div>
          <ul className="space-y-1 text-sm">
            {seats.map((u, idx) => {
              const seatNo = idx + 1;
              const tags: string[] = [];
              if (u?.isHost) tags.push("房主");
              if (u && u.sessionId === mySession) tags.push("我");
              return (
                <li
                  key={seatNo}
                  className="flex items-center justify-between rounded border px-2 py-1 bg-white"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-500">座位 {seatNo}</span>
                    <span className="truncate">{u ? (u.name || "（未命名）") : "（空位）"}</span>
                  </div>
                  {tags.length > 0 && (
                    <span className="text-xs text-gray-500">{tags.join(" · ")}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className={`text-xs mt-2 ${missing > 0 ? "text-red-600" : "text-green-600"}`}>
            {missing > 0 ? `还差 ${missing} 位玩家入局` : "人数已满，可以开始对局"}
          </div>
        </div>
      )}
    </div>
  );
}
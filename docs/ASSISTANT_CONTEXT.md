ASSISTANT_CONTEXT

本文件说明当前「愚者之石 · MVP」的**联机版（Phase 1：房主权威）**实现要点：游戏规则、架构、事件协议、客户端 RT API、调试清单、类型约定与后续规划。复制给任何加入项目的同学即可快速上手。

游戏规则

游戏目标 - 通过收集炼金石获得积分，当有玩家明分≥10时游戏结束。 - 最终按总分（明分+暗分）排名，前三名胜利并获得冠军、亚军、季军称号，其他玩家失败。 基础设置 1. 玩家身份： - 5名玩家随机抽取秘密身份，1人扮演愚者，4人扮演贤者。 - 愚者知晓【贤】和【愚】两张炼金石的初始位置。 2. 炼金石与烧瓶： - 7种炼金石：金、木、水、火、土、贤、愚。 - 7个烧瓶初始随机装入炼金石，每回合结束后炼金石回归原烧瓶。 回合流程 每回合分为炼金阶段（选牌）和施法阶段（用技能）： 一、炼金阶段 目标：按顺位选择烧瓶，获得炼金石卡牌。 1. 顺位规则： - 首回合玩家顺位随机为1-5号。 - 后续回合按当前总分从低到高排序（分低者先选）。 2. 选择烧瓶： - 顺位1号玩家：先弃掉1个烧瓶（本轮不可选），再选择1个烧瓶。 - 2-5号玩家：依次从剩余烧瓶中各选1个。 - 最后1个烧瓶未被选择，直接被弃掉。 示例： - 1号弃掉烧瓶A，选择烧瓶B； - 2号从剩余烧瓶C/D/E/F/G中选择烧瓶C； - ……直至5号选完，剩1个烧瓶未选，被弃掉。 二、施法阶段 目标：按固定顺序发动炼金石技能（可选择不展示，跳过）。 技能发动顺序与效果 炼金石 效果与得分 关键策略 金 展示 → +2明分 稳定得分优先 木 展示 → +1明分，暗中与一名玩家交换（目标非火时） → 换得的炼金石可在其固定顺序发动 抢夺关键牌+可能触发二次行动机会 水 展示 → +1明分，暗中交换自己外的两名玩家 破坏对手策略或辅助队友 火 展示 → +1明分，灼烧目标： - 目标为木 → 自己+2，目标-2（总计+3） - 否则 → 自己-1，目标+1（总计0） 高风险预判木牌位置 土 仅当当前持有者为回合初始持有者时 → 展示得+3明分 （即使被换走后重新获得，仍可发动） 避免被换，或争取被换回 贤 不可展示 → 每回合+2暗分，终局+2明分 避免被换，暗度陈仓 愚 不可展示 → 对调两组烧瓶中的炼金石（下回合生效） 回合初始持有者+1暗分，回合最终持有者-2暗分。 终局愚者持有 → +10明分，否则-5明分 干扰对手预期，希望被换，终局突袭 注意： - 发动技能后，炼金石卡牌仍留在手中，可被其他技能交换。 - 一回合内可能发动多次技能（如通过交换获得新卡牌）。 积分规则 - 明分：技能展示时立刻公开加分，全场可见。 - 暗分：仅自己知晓，回合结束时结算（如【贤】每回合+2）。 - 总分 = 明分 + 暗分 游戏结束与结算 1. 触发条件：任意玩家明分≥10时，进入终局结算。 2. 终局加成： - 【贤】持有者额外+2明分。 - 若【愚】在愚者手中 → 愚者+10明分；否则愚者-5明分。 3. 最终排名： - 按总分排序（总分相同则明分高者胜；明分相同则末回合顺位靠后者胜）。 - 奖励：冠军（100分）、亚军（50分）、季军（30分）、其他失败者（10分）。 

项目概览

前端（Vite + React + TS）

单机规则仍由 store/game 维护。

联机仅做动作层同步：房主端本地执行并广播；玩家端只发“意图”（intent）。

实时服务（Express + Socket.IO）

仅作房间 / 在线名单 / 消息转发，不保存游戏业务状态。

所有广播都局限在房间维度。

目标

先跑通“房主权威 + 广播动作”的Phase 1。

断线重连后，由房主一次广播即可让所有端恢复到最新状态（Phase 2 计划再做“完整状态快照”）。

架构（Phase 1：房主权威）

房主（Host）

点击「开始对局」：在本地 store/game 里 newGame，然后通过 RT 广播 action:newGame。

所有游戏内动作（弃/选/施法/捉弄/跳过）均先本地执行，然后广播对应 action:*。

玩家（Guest）

不直接改本地状态；只发送 intent（如 intent:pick {no}）。

服务端收到 intent 后仅转发给房主；房主端收到后执行本地动作并广播 action:*。

同步

所有端（房主 + 玩家）只对 action:* 做本地状态变更。

避免重复执行：广播消息内带 from=sessionId，房主端收到自己刚发的广播会忽略。

事件协议（Socket.IO）
房间 & 出席

room:create → ack { ok, code, users, me }
入参：{ name, sessionId }
说明：创建新房间，创建者为房主。

room:join → ack { ok, users, me }
入参：{ code, name, sessionId }
说明：加入已存在房间，如 sessionId 已在房间则更新昵称。

presence:state（广播）
载荷：{ roomCode, users: PresenceUser[] }
说明：任何进出或改名后都会推送一次。

room:close → ack { ok }
入参：{ code }（仅房主可调用）。

断开连接：服务端做简单清理；房主掉线时把房主传给在场第一个人（简单策略）。

动作 & 意图（游戏相关）

action（房主发起） → 房间广播
入参：{ room, action, data, from }
广播：{ action, payload: data, at, from }

intent（玩家发起） → 仅转发给房主
入参：{ room, action, data, from }
转发：{ action, data, from, room }（只给房主；当前未附带 at）

命名约定

动作名：'newGame' | 'discard' | 'pick' | 'nextCast' | 'foolPrank' | 'cast'

cast 的 stone 必须是联合类型：'金' | '木' | '水' | '火' | '土' | '贤' | '愚'

客户端 RT API（src/realtime/socket.ts）

暴露给业务层的最小接口：

export type ActionMsg = { action: string; payload?: any; at?: number; from?: string };

rt.getSocket(): Socket                   // 懒加载 socket
rt.emitAck<T, R>(event: string, data?: T, timeoutMs?: number): Promise<R>

rt.sendAction(action: string, payload?: any): Promise<any>     // 房主：广播
rt.sendIntent(action: string, payload?: any): Promise<any>     // 玩家：发意图

rt.subscribeAction(handler: (msg: ActionMsg) => void): () => void
// 订阅 'action' 广播；返回取消订阅函数

rt.getRoom(): string | null
rt.isHost(): boolean


设计要点

URL 解析：优先 import.meta.env.VITE_RT_URL；否则把当前端口替换为 8787（LAN 开发）。

sessionId：持久化在 localStorage，无 crypto.randomUUID 时回退到随机串。

本地房间态：只保存在 RT 单例（非 React 状态），页面用 setInterval 轮询同步（300ms）。

前端页面（src/App.tsx）关键点

动作包装：

不在房间：直接本地 store 改状态；

在房间且是房主：先本地改，再 rt.sendAction；

在房间且是玩家：rt.sendIntent，不改本地，等待房主广播 action。

接收广播：rt.subscribeAction 中 switch 分发到本地动作。

避免重复：如果 msg.from === getSessionId()，直接 return。

cast 的 stone 期望是联合类型；当前实现直接透传字符串，后续若要更严可先做 includes 守卫再断言为 Stone。

UI 限制：

建局页「开始对局」按钮：在房间且非房主则禁用；

顶部显示“房间号 + 身份”；

终局页「再来一局」同样走 doNewGame() 包装逻辑。

实时服务（realtime-server/src/index.ts）关键点

CORS：origin: "*", methods: ["GET", "POST"]

公开健康检查：GET / → Fool-Stone Realtime OK

内存模型：

type PresenceUser = { id: string; name: string; sessionId: string; isHost?: boolean };
type Room = { code: string; users: Map<string, PresenceUser>; hostSessionId: string; createdAt: number };


事件（与上文协议一致）：

room:create / room:join / presence:state / room:close / action / intent

转发策略：

action：io.to(room).emit("action", {..., from})

intent：io.to(hostSocketId).emit("intent", {..., from})（仅房主收到）

环境与部署

前端：

局域网测试：在项目根的 .env.local 设置

VITE_RT_URL=http://<你的局域网IP>:8787


重新启动前端 dev 以生效。

服务端：

PORT 默认 8787。

同机开发：http://localhost:8787/ 打开能看到 “Fool-Stone Realtime OK”。

本地存储（目前可能出现的键）

sessionId：用于身份与重连。

name：面板输入的昵称。

lastRoomCode：面板最近一次房间号。

说明：旧版本可能写过 isHost，当前实现不依赖该键（以服务器 presence 结果为准）。

调试排障清单

手机端“未连接”

检查 .env.local 的 VITE_RT_URL 是否为 可被手机访问的 LAN 地址（不是 localhost）。

两端是否在同一 Wi-Fi（注意路由器隔离）。

创建/加入按钮灰

先看“连接：已连接”。未连接时按钮会禁用。

加入房间后仍各玩各的

房主端是否真的广播了 action（看服务端日志 / 浏览器网络）？

玩家端是否收到了 action（rt.subscribeAction 打印）？

类型报错：stone 是 string

仅在 cast 收到网络数据时做联合类型守卫，再传给 castStoneLocal。

房主身份丢失

房主断线重连：当前为“简单策略”，可能被移交给第一位在场者。重新创建房间或补充“主机保留”策略。

类型约定 & 代码风格

Stone：

const CAST_ORDER = ['金','木','水','火','土','贤','愚'] as const;
type Stone = typeof CAST_ORDER[number];


castStoneLocal(playerId: string, stone: Stone, mode?: string, a?: string, b?: string)

所有调用点都必须是 Stone 类型；外部输入（网络）需先校验后断言。

ActionMsg：

type ActionMsg = { action: string; payload?: any; at?: number; from?: string };


订阅返回值必须可取消（subscribeAction -> () => void）。

避免滥用全局 localStorage.isHost，以 rt.isHost() 为准。

已知限制 & 下一步（建议）

Phase 1（已完成）：动作广播型同步，房主权威。

Phase 2（建议）：

增加 state:full（完整快照）与 state:patch（增量）。

玩家入房 / 重连后，向房主请求 state:full，再继续接收 action。

Phase 3（可选）：

服务端持久化（Redis / KV）+ 房主迁移 + 旁观者模式。

变更小记（本轮关键）

新增 action / intent 事件，区分广播与意图。

前端 App.tsx 统一通过包装函数决定“本地执行 + 广播”还是“发意图”。

stone 严格改为联合类型 Stone，避免 TS 2345。

.env.local 支持 VITE_RT_URL 指向 LAN 服务，便于手机测试。

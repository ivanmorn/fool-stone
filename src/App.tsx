// src/App.tsx
import { useEffect, useRef, useState } from 'react';
import { useGame } from './store/game';
import './index.css';

const CAST_ORDER = ['金', '木', '水', '火', '土', '贤', '愚'] as const;
type Stone = typeof CAST_ORDER[number];

export default function App() {
  // —— 全局状态 —— //
  const g = useGame(s => s.game);
  const isOver = useGame(s => s.isOver);
  const finalRanks = useGame(s => s.finalRanks);
  const endThreshold = useGame(s => s.endThreshold);
  const setEndThreshold = useGame(s => s.setEndThreshold);
  const flaskMap = useGame(s => s.flaskMap);
  const nextFlaskMap = useGame(s => s.nextFlaskMap);
  const foolPrankUsed = useGame(s => s.foolPrankUsed);
  const roundStartScores = useGame(s => s.roundStartScores);

  // —— 天象占卜（从 game 对象读取；第3回合起可能有值） —— //
  const omenStone = useGame(
    s => (s.game as any)?.omenStone as (typeof CAST_ORDER)[number] | null
  );

  // —— 动作 —— //
  const newGame = useGame(s => s.newGame);
  const discardFlask = useGame(s => s.discardFlask);
  const pickFlask = useGame(s => s.pickFlask);
  const castStone = useGame(s => s.castStone);
  const nextCast = useGame(s => s.nextCast);
  const foolPrank = useGame(s => s.foolPrank);

  // —— 本地 UI 状态 —— //
  const [peekId, setPeekId] = useState<string | null>(null);
  const [woodTarget, setWoodTarget] = useState<string | null>(null);
  const [waterTargets, setWaterTargets] = useState<string[]>([]);
  const [fireTarget, setFireTarget] = useState<string | null>(null);
  const [names, setNames] = useState(['甲', '乙', '丙', '丁', '戊']);
  const [thresholdSel, setThresholdSel] = useState<number>(endThreshold);
  const [showRules, setShowRules] = useState(false);

  // —— 日志自动滚动 —— //
  const logRef = useRef<HTMLDivElement | null>(null);
  const finalLogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [g?.logs.length]);
  useEffect(() => {
    if (finalLogRef.current) finalLogRef.current.scrollTop = finalLogRef.current.scrollHeight;
  }, [isOver, g?.logs.length]);

  // —— 规则弹窗 —— //
  const RulesModal = () => (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => setShowRules(false)}
    >
      <div
        className="bg-white rounded-xl p-5 w-[90%] max-w-sm max-h-[80vh] overflow-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-bold mb-2">获取游戏规则</div>
        <p className="text-sm text-gray-700">
          关注 <b>「JokerGame愚人博弈」</b> 微信服务号，进入后台，文字回复 <b>愚者之石</b> 即可获得游戏规则。
        </p>
        <img
          src="/wechat-qrcode.jpg"
          alt="JokerGame愚人博弈 微信服务号二维码"
          className="w-40 h-40 mx-auto my-3 rounded"
        />
        <button
          className="w-full px-3 py-2 rounded border mt-2"
          onClick={() => setShowRules(false)}
        >
          我知道了
        </button>
      </div>
    </div>
  );

  // =========================
  //  终局画面
  // =========================
  if (isOver && g) {
    return (
      <div className="min-h-screen p-6 max-w-xl mx-auto space-y-4 bg-white">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">愚者之石 · 终局结算</h1>
          <button
            className="text-sm px-3 py-1 rounded border hover:bg-gray-50"
            onClick={() => setShowRules(true)}
          >
            获取规则
          </button>
        </div>
        <div className="text-sm text-gray-600">阈值：明分 ≥ {endThreshold}</div>

        <div className="p-3 border rounded space-y-4">
          <div>
            <div className="font-medium mb-2">复盘：最终烧瓶 → 炼金石</div>
            {flaskMap ? (
              <div className="grid grid-cols-7 gap-2 text-center">
                {Array.from({ length: 7 }, (_, i) => i + 1).map(n => (
                  <div key={n} className="border rounded p-2">
                    <div className="text-xs text-gray-500 flex items-center justify-center gap-1 leading-none">
                      <span>烧瓶</span>
                      <span className="tabular-nums">{n}</span>
                    </div>
                    <div className="text-lg font-bold">{flaskMap[n] ?? '-'}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500">（无数据）</div>
            )}
          </div>

          <div>
            <div className="font-medium mb-2">身份与最终持有（最终回合分数变化）</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1">玩家</th>
                  <th className="py-1">身份</th>
                  <th className="py-1">最终持有</th>
                  <th className="py-1">明分变化</th>
                  <th className="py-1">暗分变化</th>
                </tr>
              </thead>
              <tbody>
                {g.players.map(p => {
                  const role = p.isFool ? '愚者' : '贤者';
                  const stone = g.hands[p.id] ?? '—';
                  const cur = g.scores[p.id];
                  const base = roundStartScores?.[p.id] ?? { pub: 0, sec: 0 };
                  const dPub = cur.pub - base.pub;
                  const dSec = cur.sec - base.sec;
                  const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-1">{p.name}</td>
                      <td className="py-1">{role}</td>
                      <td className="py-1">{stone}</td>
                      <td className="py-1">{fmt(dPub)}</td>
                      <td className="py-1">{fmt(dSec)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-3 border rounded">
          <div className="font-medium mb-2">最终排名</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1">名次</th>
                <th className="py-1">玩家</th>
                <th className="py-1">明分</th>
                <th className="py-1">暗分</th>
                <th className="py-1">总分</th>
                <th className="py-1">奖励</th>
              </tr>
            </thead>
            <tbody>
              {finalRanks?.map(r => (
                <tr key={r.playerId} className="border-b last:border-0">
                  <td className="py-1">{r.place}</td>
                  <td className="py-1">{r.name}</td>
                  <td className="py-1">{r.pub}</td>
                  <td className="py-1">{r.sec}</td>
                  <td className="py-1 font-medium">{r.total}</td>
                  <td className="py-1">{r.reward}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          className="px-4 py-2 rounded bg-black text-white"
          onClick={() => {
            setEndThreshold(thresholdSel);
            newGame(names);
          }}
        >
          再来一局（沿用当前玩家）
        </button>

        <div className="p-3 border rounded">
          <div className="font-medium mb-1">公开日志</div>
          <div ref={finalLogRef} className="max-h-72 overflow-auto px-2">
            <ol className="list-decimal list-inside space-y-1">
              {g.logs.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          </div>
        </div>
        {showRules && <RulesModal />}
      </div>
    );
  }

  // =========================
  //  建局画面
  // =========================
  if (!g) {
    return (
      <div className="min-h-screen p-6 max-w-xl mx-auto space-y-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">愚者之石 · MVP</h1>
          <button
            className="text-sm px-3 py-1 rounded border hover:bg-gray-50"
            onClick={() => setShowRules(true)}
          >
            获取规则
          </button>
        </div>

        <p className="text-sm text-gray-600">先输入 5 位玩家名，选择终局阈值，然后开始对局。</p>

        <div className="grid grid-cols-5 gap-2">
          {names.map((n, i) => (
            <input
              key={i}
              className="border rounded p-2"
              value={n}
              onChange={e => setNames(v => v.map((x, ix) => (ix === i ? e.target.value : x)))}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-700">终局阈值（明分 ≥ ）</label>
          <select
            className="border rounded px-2 py-1"
            value={thresholdSel}
            onChange={e => setThresholdSel(parseInt(e.target.value, 10))}
          >
            {[5, 6, 7, 8, 9, 10, 11, 12].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <button
          className="px-4 py-2 rounded bg-black text-white"
          onClick={() => {
            setEndThreshold(thresholdSel);
            newGame(names);
          }}
        >
          开始对局
        </button>

        {showRules && <RulesModal />}
      </div>
    );
  }

  // =========================
  //  对局中：公共信息
  // =========================
  const pickerIndex = g.picks.length;
  const currentPickerId = g.order[pickerIndex];
  const currentPickerName = g.players.find(p => p.id === currentPickerId)?.name ?? currentPickerId;
  const availableFlasks = Object.keys(g.flasks).map(n => Number(n)).sort((a, b) => a - b);

  const currentIndex = Math.min(g.castIdx, CAST_ORDER.length - 1);
  const currentStone = CAST_ORDER[currentIndex];

  const orderedPlayers = g.order.map((pid, idx) => {
    const p = g.players.find(x => x.id === pid)!;
    return { rank: idx + 1, player: p };
  });

  const phaseLabel = g.phase === 'select' ? '炼金' : '施法';
  const phaseIsSelect = g.phase === 'select';

  return (
    <div className="min-h-screen p-6 max-w-xl mx-auto space-y-4 bg-white">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">愚者之石 · MVP</h1>
        <button
          className="text-sm px-3 py-1 rounded border hover:bg-gray-50"
          onClick={() => setShowRules(true)}
        >
          获取规则
        </button>
      </div>

      {/* 顶部信息：阈值/回合阶段 + 天象占卜（第3回合起在整个回合内显示） */}
      <div className="p-3 border rounded space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">终局阈值：明分 ≥ {endThreshold}</span>
          <span>
            回合：<b>{g.round}</b>　阶段：<b>{phaseLabel}</b>
          </span>
        </div>

        {g.round >= 3 && omenStone && (
          <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
            天象占卜：本回合【<b>{omenStone}</b>】效果增强（仅当回合有效）
          </div>
        )}
      </div>

      {/* 玩家回合顺位及明分 */}
      <div className="p-3 border rounded space-y-2">
        <div className="font-medium">玩家回合顺位及明分</div>
        <ul className="grid grid-cols-2 gap-2">
          {orderedPlayers.map(({ rank, player }) => {
            const s = g.scores[player.id];
            return (
              <li
                key={player.id}
                className="flex items-center justify-between border rounded px-2 py-1 cursor-pointer hover:bg-gray-50"
                title={`顺位 ${rank}`}
                onClick={() => {
                  setPeekId(player.id);
                  setWoodTarget(null);
                  setWaterTargets([]);
                  setFireTarget(null);
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-900 text-white text-xs shrink-0">{rank}</span>
                  <span className="truncate">{player.name}</span>
                </div>
                <span className="ml-2 shrink-0">明 {s.pub}</span>
              </li>
            );
          })}
        </ul>
        <div className="text-sm text-gray-600">
          {phaseIsSelect
            ? '点击自己的名字查看个人信息。'
            : '点击自己的名字查看个人信息，若轮到你持有的炼金石，可发动技能，否则关闭弹窗。'}
        </div>
      </div>

      {/* 选瓶阶段 */}
      {g.phase === 'select' && (
        <div className="p-3 border rounded space-y-2">
          {g.discarded.length === 0 ? (
            <div>
              <div className="font-medium mb-2">
                请 <b>{g.players.find(p => p.id === g.order[0])?.name ?? '1号'}</b> 先弃 1 个烧瓶：
              </div>
              <div className="flex flex-wrap gap-2">
                {availableFlasks.map(no => (
                  <button key={no} className="px-3 py-2 border rounded hover:bg-gray-50" onClick={() => discardFlask(no)}>{no}</button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="font-medium mb-2">轮到 <b>{currentPickerName}</b> 选烧瓶：</div>
              <div className="flex flex-wrap gap-2">
                {availableFlasks.map(no => (
                  <button key={no} className="px-3 py-2 border rounded hover:bg-gray-50" onClick={() => pickFlask(no)}>{no}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 施法阶段：顺序第一行；当前+按钮第二行 */}
      {g.phase === 'cast' && (
        <div className="p-3 border rounded space-y-2">
          <div className="font-medium text-sm sm:text-base tracking-tight leading-tight">
            施法顺序：
            {CAST_ORDER.map((st, idx) => (
              <span key={st} className={idx === g.castIdx ? 'px-1 font-bold text-blue-600' : 'px-1'}>
                {st}{idx < CAST_ORDER.length - 1 ? '→' : ''}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">（当前：{currentStone}）</span>
            <button className="px-3 py-2 border rounded" onClick={() => nextCast()}>跳过当前</button>
          </div>
        </div>
      )}

      {/* —— 私密查看对话框 —— */}
      {peekId && (() => {
        const player = g.players.find(p => p.id === peekId)!;
        const stone = g.hands[peekId] as Stone | undefined;
        const canCast = !phaseIsSelect && stone === currentStone && g.castIdx < CAST_ORDER.length;

        const isWood  = canCast && stone === '木';
        const isWater = canCast && stone === '水';
        const isFire  = canCast && stone === '火';
        const isEarth = canCast && stone === '土';
        const isSage  = canCast && stone === '贤';
        const isFool  = canCast && stone === '愚';

        const role = player.isFool ? '愚者' : '贤者';
        const earthInitialId = g.initialHolder['土'];

        const locate = (map?: Record<number, string | undefined>) => {
          if (!map) return { sage: '-', fool: '-' };
          const entries = Object.entries(map);
          const s = entries.find(([, v]) => v === '贤')?.[0] ?? '-';
          const f = entries.find(([, v]) => v === '愚')?.[0] ?? '-';
          return { sage: s, fool: f };
        };
        const nowInfo  = locate(flaskMap as any);
        const nextInfo = locate(nextFlaskMap as any);

        const myScore = g.scores[player.id];
        const myTotal = myScore.pub + myScore.sec;

        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPeekId(null)}>
            <div className="bg-white rounded-xl p-5 w-[90%] max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="text-lg font-bold mb-2">私密查看</div>

              <div className="text-center my-6 space-y-1">
                <div className="text-4xl font-extrabold tracking-widest">{stone ?? '（尚未拿到）'}</div>
                <div className="text-gray-500">{player.name} 当前持有炼金石</div>
                <div className="text-xs text-gray-600">你的身份：<b>{role}</b></div>
                <div className="text-xs text-gray-600">你的分数：总 <b>{myTotal}</b>（明 <b>{myScore.pub}</b> / 暗 <b>{myScore.sec}</b>）</div>
              </div>

              {/* 愚者情报 */}
              {player.isFool && (
                <div className="mb-4 p-3 border rounded bg-yellow-50">
                  <div className="font-medium mb-1">愚者情报</div>
                  <div className="text-xs text-gray-700">
                    当前<b>烧瓶与炼金石的对应关系</b>：贤＠烧瓶 <b>{nowInfo.sage}</b>，愚＠烧瓶 <b>{nowInfo.fool}</b>
                  </div>
                  {nextFlaskMap ? (
                    <div className="text-xs text-gray-700 mt-1">
                      下回合（已捉弄后）<b>烧瓶与炼金石的对应关系</b>：贤＠烧瓶 <b>{nextInfo.sage}</b>，愚＠烧瓶 <b>{nextInfo.fool}</b>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 mt-1">下回合：未捉弄（默认沿用当前<b>对应关系</b>）</div>
                  )}
                  <button
                    className="mt-2 w-full px-3 py-2 rounded border disabled:opacity-50"
                    onClick={() => foolPrank()}
                    disabled={foolPrankUsed || phaseIsSelect}
                    title={
                      phaseIsSelect
                        ? '炼金阶段不可使用愚者捉弄'
                        : (foolPrankUsed ? '本局已使用过愚者捉弄' : '立刻随机打乱下回合的烧瓶与炼金石对应关系（整局仅限一次）')
                    }
                  >
                    {foolPrankUsed ? '愚者捉弄（本局已使用）' : (phaseIsSelect ? '愚者捉弄（炼金阶段不可用）' : '愚者捉弄（打乱下回合对应关系）')}
                  </button>
                </div>
              )}

              {/* 炼金阶段：只显示“我看完了” */}
              {phaseIsSelect && (
                <button className="w-full px-3 py-2 rounded border" onClick={() => setPeekId(null)}>
                  我看完了
                </button>
              )}

              {/* 木 */}
              {!phaseIsSelect && isWood && (
                <>
                  <div className="text-sm font-medium mb-2">选择一名玩家进行交换</div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {g.players.filter(x => x.id !== player.id).map(o => (
                      <button
                        key={o.id}
                        className={`px-3 py-2 border rounded ${woodTarget === o.id ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
                        onClick={() => setWoodTarget(o.id)}
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                      disabled={!woodTarget}
                      onClick={() => { castStone(player.id, '木', 'show', woodTarget!); setPeekId(null); setWoodTarget(null); }}
                    >
                      发动（展示）
                    </button>
                    <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                  </div>
                </>
              )}

              {/* 水 */}
              {!phaseIsSelect && isWater && (
                <>
                  <div className="text-sm font-medium mb-2">选择两名玩家进行对调</div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {g.players.filter(x => x.id !== player.id).map(o => (
                      <button
                        key={o.id}
                        className={`px-3 py-2 border rounded ${waterTargets.includes(o.id) ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
                        onClick={() => {
                          setWaterTargets(prev => {
                            if (prev.includes(o.id)) return prev.filter(x => x !== o.id);
                            if (prev.length >= 2) return prev;
                            return [...prev, o.id];
                          });
                        }}
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500 mb-2">已选：{waterTargets.length} / 2</div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                      disabled={waterTargets.length !== 2}
                      onClick={() => { castStone(player.id, '水', 'show', waterTargets[0], waterTargets[1]); setPeekId(null); setWaterTargets([]); }}
                    >
                      发动（展示）
                    </button>
                    <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                  </div>
                </>
              )}

              {/* 火 */}
              {!phaseIsSelect && isFire && (
                <>
                  <div className="text-sm font-medium mb-2">选择一名玩家进行灼烧</div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {g.players.filter(x => x.id !== player.id).map(o => (
                      <button
                        key={o.id}
                        className={`px-3 py-2 border rounded ${fireTarget === o.id ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
                        onClick={() => setFireTarget(o.id)}
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                      disabled={!fireTarget}
                      onClick={() => { castStone(player.id, '火', 'show', fireTarget!); setPeekId(null); setFireTarget(null); }}
                    >
                      发动（展示）
                    </button>
                    <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                  </div>
                </>
              )}

              {/* 土 */}
              {!phaseIsSelect && isEarth && (
                <div className="space-y-2">
                  <div className="text-sm text-gray-600">只有本回合「土」的初始持有者可发动（+3 明分）。</div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-40"
                      disabled={earthInitialId !== player.id}
                      title={earthInitialId === player.id ? '' : '你不是本回合「土」的初始持有者'}
                      onClick={() => { castStone(player.id, '土', 'show'); setPeekId(null); }}
                    >
                      发动（展示）
                    </button>
                    <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                  </div>
                </div>
              )}

              {/* 贤 / 愚：不可展示 */}
              {!phaseIsSelect && (isSage || isFool) && (
                <div className="space-y-3">
                  <div className="text-sm text-gray-600">【{isSage ? '贤' : '愚'}】不可展示。请关闭弹窗，如需推进流程由主持人点击外部「跳过当前」。</div>
                  <button className="w-full px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                </div>
              )}

              {/* 金：普通展示 */}
              {!phaseIsSelect && !isWood && !isWater && !isFire && !isEarth && !isSage && !isFool && canCast && (
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 rounded bg-black text-white" onClick={() => { castStone(player.id, stone!, 'show'); setPeekId(null); }}>
                    发动（展示）
                  </button>
                  <button className="px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
                </div>
              )}

              {!phaseIsSelect && !canCast && (
                <button className="w-full px-3 py-2 rounded border" onClick={() => setPeekId(null)}>我看完了</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* 公开日志 */}
      <div className="p-3 border rounded">
        <div className="font-medium mb-1">公开日志</div>
        <div ref={logRef} className="max-h-72 overflow-auto px-2">
          <ol className="list-decimal list-inside space-y-1">
            {g.logs.map((l, i) => (<li key={i}>{l}</li>))}
          </ol>
        </div>
      </div>

      {showRules && <RulesModal />}
    </div>
  );
}
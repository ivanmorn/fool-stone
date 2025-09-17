// src/store/game.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import seedrandom from 'seedrandom';
import type { Game, Player, Score, Stone, FinalRankRow, GameSnapshot } from '../types';
import { STONES } from '../types';

function shuffle<T>(seed: string, arr: T[]) {
  const r = seedrandom(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function emptyInitialHolder(): Record<Stone, string | null> {
  return { 金: null, 木: null, 水: null, 火: null, 土: null, 贤: null, 愚: null };
}

const ORDER: Stone[] = ['金', '木', '水', '火', '土', '贤', '愚'];

const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type Store = {
  game: Game | null;

  endThreshold: number;
  setEndThreshold: (n: number) => void;

  isOver: boolean;
  finalRanks: FinalRankRow[] | null;

  flaskMap: Record<number, Stone> | null;
  nextFlaskMap: Record<number, Stone> | null;
  foolPrankUsed: boolean;

  roundStartScores: Record<string, Score> | null;

  newGame: (names: string[], seed?: string) => void;
  startRound: () => void;

  discardFlask: (flaskNo: number) => void;
  pickFlask: (flaskNo: number) => void;

  nextCast: () => void;
  castStone: (
    playerId: string,
    stone: '金'|'木'|'水'|'火'|'土'|'贤'|'愚',
    action: 'show'|'skip',
    targetId?: string,
    targetId2?: string,
  ) => void;

  foolPrank: () => void;

  exportSnapshot: () => GameSnapshot;
  applySnapshot: (snapshot: GameSnapshot) => void;
};

export const useGame = create<Store>()(
  immer((set, get) => ({
    game: null,

    endThreshold: 10,
    setEndThreshold: (n) => set({ endThreshold: Math.max(5, Math.min(12, n)) }),

    isOver: false,
    finalRanks: null,

    flaskMap: null,
    nextFlaskMap: null,
    foolPrankUsed: false,
    roundStartScores: null,

    // —— 建局 —— //
    newGame: (names, seed = Date.now().toString()) => {
      set((state) => {
        state.isOver = false;
        state.finalRanks = null;
        state.roundStartScores = null;
        state.nextFlaskMap = null;
        state.foolPrankUsed = false;
      });

      const players: Player[] = names.map((n, i) => ({ id: `P${i + 1}`, name: n }));
      const foolIndex = Math.floor(seedrandom(seed)() * players.length);
      players[foolIndex].isFool = true;

      const order = shuffle(seed + '#order', players.map(p => p.id));
      const scores = players.reduce<Record<string, Score>>((acc, p) => {
        acc[p.id] = { pub: 0, sec: 0 };
        return acc;
      }, {});
      const hands = players.reduce<Record<string, Stone | null>>((acc, p) => {
        acc[p.id] = null;
        return acc;
      }, {});

      // 固定：烧瓶 → 炼金石（1..7）
      const fixed = Object.fromEntries(
        shuffle(seed + '#flasks', STONES).map((st, i) => [i + 1, st])
      ) as Record<number, Stone>;

      const g: Game = {
        id: seed,
        seed,
        round: 1,
        players,
        order,
        scores,
        hands,
        phase: 'select',
        flasks: {},
        discarded: [],
        picks: [],
        initialHolder: emptyInitialHolder(),
        logs: ['对局开始。愚者已随机确定。'],
        castIdx: 0,
        omenStone: null,
      };

      set(state => {
        state.game = g;
        state.flaskMap = fixed;
      });
      get().startRound();
    },

    // —— 开新回合 —— //
    startRound: () => {
      set(state => {
        const gg = state.game!;
        if (state.nextFlaskMap) {
          state.flaskMap = state.nextFlaskMap;
          state.nextFlaskMap = null;
        }
        const map = state.flaskMap!;

        // 回合2起：总分低→高；同总分则明分低→高；再按上回合相对顺序
        if (gg.round > 1) {
          const prevOrderIndex = new Map(gg.order.map((id, i) => [id, i]));
          const ids = gg.players.map(p => p.id);
          ids.sort((a, b) => {
            const ta = gg.scores[a].pub + gg.scores[a].sec;
            const tb = gg.scores[b].pub + gg.scores[b].sec;
            if (ta !== tb) return ta - tb;
            const pa = gg.scores[a].pub;
            const pb = gg.scores[b].pub;
            if (pa !== pb) return pa - pb;
            return (prevOrderIndex.get(a) ?? 0) - (prevOrderIndex.get(b) ?? 0);
          });
          gg.order = ids;
        }

        gg.flasks = { ...map };
        state.roundStartScores = JSON.parse(JSON.stringify(gg.scores));

        gg.discarded = [];
        gg.picks = [];
        gg.initialHolder = emptyInitialHolder();
        gg.phase = 'select';
        gg.castIdx = 0;
        gg.logs.push(`—— 第 ${gg.round} 回合开始（烧瓶复位）——`);

        // 🔮 天象占卜：第 3 回合起，每回合固定一次（种子包含 round，确保回合间不同）
        if (gg.round >= 3) {
          const choices: Stone[] = ['金', '木', '水', '火', '土', '贤', '愚'];
          const rng = seedrandom(gg.seed + '#omen#round=' + gg.round);
          const omen = choices[Math.floor(rng() * choices.length)];
          gg.omenStone = omen;
          gg.logs.push(`🔮 天象占卜：本回合【${omen}】效果增强（仅当回合有效，不影响终局加成）`);
        } else {
          gg.omenStone = null;
        }

        // 清空所有手牌
        for (const pid of gg.players.map(p => p.id)) gg.hands[pid] = null;
      });
    },

    // —— 1号弃瓶 —— //
    discardFlask: (flaskNo) => {
      set(state => {
        const gg = state.game!;
        if (gg.phase !== 'select') return;
        if (gg.discarded.length > 0) return;
        if (!(flaskNo in gg.flasks)) return;

        delete gg.flasks[flaskNo];
        gg.discarded.push(flaskNo);
        const firstName = gg.players.find(p => p.id === gg.order[0])?.name ?? '1号';
        // 公共日志不暴露编号
        gg.logs.push(`🗑️ ${firstName} 弃掉了一个烧瓶`);
      });
    },

    // —— 依顺位选瓶 —— //
    pickFlask: (flaskNo) => {
      set(state => {
        const gg = state.game!;
        if (gg.phase !== 'select') return;
        if (!(flaskNo in gg.flasks)) return;

        const pickerIndex = gg.picks.length;
        if (pickerIndex === 0 && gg.discarded.length === 0) return;

        const playerId = gg.order[pickerIndex];
        const stone = gg.flasks[flaskNo];

        gg.hands[playerId] = stone;
        if (!gg.initialHolder[stone]) {
          gg.initialHolder[stone] = playerId;

          // 愚：初始持有者 +1 暗分（若天象为“愚”，则 +2）
          const omen: Stone | null = gg.omenStone ?? null;
          gg.scores[playerId].sec += (stone === '愚' ? (omen === '愚' ? 2 : 1) : 0);
        }
        gg.picks.push({ playerId, flask: flaskNo, stone });
        delete gg.flasks[flaskNo];

        const pname = gg.players.find(p => p.id === playerId)?.name ?? playerId;
        // 公共日志不暴露编号
        gg.logs.push(`🧪 ${pname} 选择了一个烧瓶`);

        if (gg.picks.length === 5) {
          const left = Object.keys(gg.flasks).map(n => Number(n));
          if (left.length === 1) {
            const last = left[0];
            delete gg.flasks[last];
            gg.discarded.push(last);
            // 公共日志不暴露编号
            gg.logs.push(`🗑️ 最后剩余的一个烧瓶被自动弃置`);
          }
          gg.phase = 'cast';
          gg.castIdx = 0;
          gg.logs.push(`➡️ 进入施法阶段`);
          gg.logs.push(`➡️ 轮到【${ORDER[gg.castIdx]}】发动`);
        }
      });
    },

    // —— 主持人“跳过当前”/推进 —— //
    nextCast: () => {
      let endOfRound = false;

      set(state => {
        const gg = state.game!;
        if (gg.phase !== 'cast') return;

        const omen: Stone | null = gg.omenStone ?? null;
        const current = ORDER[gg.castIdx];
        let justFinishedEarth = false;

        if (current === '贤') {
          const add = 2 + (omen === '贤' ? 1 : 0);
          gg.logs.push(`🧠 【贤】不公开（持有者 +${add} 暗分)`);
          const holder = gg.players.find(p => gg.hands[p.id] === '贤');
          if (holder) gg.scores[holder.id].sec += add;
          gg.castIdx += 1;
        } else if (current === '愚') {
          gg.logs.push(`🃏 【愚】不公开（回合初始持有者+${omen==='愚'?2:1}暗分，回合最终持有者-2暗分)`);
          gg.castIdx += 1;
        } else {
          gg.logs.push(`⏭️ 主持人跳过【${current}】`);
          if (current === '土') justFinishedEarth = true;
          gg.castIdx += 1;
        }

        // —— 土后自动跑完“贤/愚” —— //
        const runAutoSageFool = () => {
          while (gg.castIdx < ORDER.length) {
            const st = ORDER[gg.castIdx];
            if (st === '贤') {
              const add = 2 + (gg.omenStone === '贤' ? 1 : 0);
              gg.logs.push(`➡️ 轮到【贤】发动`);
              gg.logs.push(`🧠 【贤】不公开（持有者 +${add} 暗分)`);
              const holder = gg.players.find(p => gg.hands[p.id] === '贤');
              if (holder) gg.scores[holder.id].sec += add;
              gg.castIdx += 1;
              continue;
            }
            if (st === '愚') {
              const foolBoost = gg.omenStone === '愚' ? 2 : 1;
              gg.logs.push(`➡️ 轮到【愚】发动`);
              gg.logs.push(`🃏 【愚】不公开（回合初始持有者+${foolBoost}暗分，回合最终持有者-2暗分)`);
              gg.castIdx += 1;
              continue;
            }
            break;
          }
        };

        if (justFinishedEarth) {
          runAutoSageFool();
        } else if (gg.castIdx < ORDER.length) {
          gg.logs.push(`➡️ 轮到【${ORDER[gg.castIdx]}】发动`);
        }

        if (gg.castIdx >= ORDER.length) {
          // 回合结束：最终持有【愚】者 -2 暗分（不受天象影响）
          const fHolder = gg.players.find(p => gg.hands[p.id] === '愚');
          if (fHolder) gg.scores[fHolder.id].sec -= 2;
          gg.logs.push(`✅ 第 ${gg.round} 回合施法结束`);
          gg.phase = 'select';
          gg.round += 1;
          endOfRound = true;
        }
      });

      if (endOfRound) {
        // 回合结束后再检阈值
        const s = get();
        const threshold = s.endThreshold;
        const g = s.game!;
        const hitPlayers = g.players.filter(p => g.scores[p.id].pub >= threshold);

        if (hitPlayers.length > 0) {
          set(state => {
            const gg = state.game!;
            const trigger = [...hitPlayers].sort((a,b)=>g.scores[b.id].pub - g.scores[a.id].pub)[0];
            gg.logs.push(`🏁 终局触发：${trigger.name} 的明分达到 ${threshold} 分（≥ 阈值）`);

            const sage = gg.players.find(p => gg.hands[p.id] === '贤');
            if (sage) {
              gg.scores[sage.id].pub += 2; // 终局贤者加成不受天象影响
              gg.logs.push(`🧠 终局：${sage.name} 最终持有【贤】，+2 明分`);
            } else {
              gg.logs.push(`🧠 终局：无人最终持有【贤】（无加成）`);
            }

            const fool = gg.players.find(p => p.isFool);
            if (fool) {
              const hasF = gg.hands[fool.id] === '愚';
              gg.scores[fool.id].pub += hasF ? 10 : -5; // 终局愚者加成不受天象影响
              gg.logs.push(
                hasF
                  ? `🃏 终局：${fool.name} 为愚者，且最终持有【愚】（+10 明分）`
                  : `🃏 终局：${fool.name} 为愚者，但未持有【愚】（-5 明分）`
              );
            }

            const rows = gg.players.map(p => {
              const pub = gg.scores[p.id].pub;
              const sec = gg.scores[p.id].sec;
              const total = pub + sec;
              return { playerId: p.id, name: p.name, pub, sec, total };
            }).sort((a,b) => {
              if (b.total !== a.total) return b.total - a.total;
              if (b.pub !== a.pub) return b.pub - a.pub;
              const ai = gg.order.indexOf(a.playerId);
              const bi = gg.order.indexOf(b.playerId);
              return bi - ai;
            });

            const rewards = [100,50,30,10,10];
            const finalRanks: FinalRankRow[] = rows.map((r, i) => ({
              ...r, place: i+1, reward: rewards[i] ?? 10
            }));

            state.isOver = true;
            state.finalRanks = finalRanks;
            gg.logs.push(`🏆 终局结算完成（已生成排名）`);
          });
        } else {
          get().startRound();
        }
      }
    },

    // —— 持有者在弹窗“发动/关闭” —— //
    castStone: (playerId, stone, action, targetId, targetId2) => {
      let endOfRound = false;

      set(state => {
        const gg = state.game!;
        if (state.isOver) return;
        if (gg.phase !== 'cast') return;

          const omen: Stone | null = gg.omenStone ?? null;
        const current = ORDER[gg.castIdx];
        if (stone !== current) {
          gg.logs.push(`⚠️ 现在轮到【${current}】，不是【${stone}】`);
          return;
        }

        if ((stone === '贤' || stone === '愚') && action === 'show') {
          gg.logs.push(`⚠️ 【${stone}】不可展示`);
          return;
        }

        if (gg.hands[playerId] !== stone) {
          gg.logs.push(`⚠️ 非持有者尝试操作【${stone}】，已忽略`);
          return;
        }

        const pname = gg.players.find(p => p.id === playerId)?.name ?? playerId;

        if (action === 'skip') {
          gg.logs.push(`😐 ${pname} 跳过了【${stone}】`);
          gg.castIdx += 1;
        } else {
          switch (stone) {
            case '金': {
              const add = 2 + (omen === '金' ? 1 : 0);
              gg.scores[playerId].pub += add;
              gg.logs.push(`✨ ${pname} 展示了【金】，+${add} 明分`);
              gg.castIdx += 1;
              break;
            }
            case '木': {
              const add = 1 + (omen === '木' ? 1 : 0);
              gg.scores[playerId].pub += add;
              if (targetId && targetId !== playerId) {
                const tStone = gg.hands[targetId];
                if (tStone && tStone !== '火') {
                  const self = gg.hands[playerId]; // '木'
                  gg.hands[playerId] = tStone;
                  gg.hands[targetId] = self;
                }
              }
              gg.logs.push(`🌲 ${pname} 展示了【木】，+${add} 明分（暗中与一名玩家交换）`);
              gg.castIdx += 1;
              break;
            }
            case '水': {
              const add = 1 + (omen === '水' ? 1 : 0);
              gg.scores[playerId].pub += add;
              if (
                targetId && targetId2 &&
                targetId !== targetId2 &&
                targetId !== playerId && targetId2 !== playerId
              ) {
                const st1 = gg.hands[targetId];
                const st2 = gg.hands[targetId2];
                if (st1 != null && st2 != null) {
                  gg.hands[targetId] = st2;
                  gg.hands[targetId2] = st1;
                }
              } else {
                gg.logs.push(`⚠️ 【水】需要选择两名不同的其他玩家`);
                return;
              }
              gg.logs.push(`💧 ${pname} 展示了【水】，+${add} 明分（已暗中对调两名玩家）`);
              gg.castIdx += 1;
              break;
            }
            case '火': {
              if (!targetId || targetId === playerId) {
                gg.logs.push(`🔥 ${pname} 展示了【火】`);
                return;
              }
              const tStone = gg.hands[targetId];
              const tname = gg.players.find(p => p.id === targetId)?.name ?? targetId;

              // 展示先 +1 明分（固定）
              gg.scores[playerId].pub += 1;

              const fireBoost = gg.omenStone === '火' ? 1 : 0;
              if (tStone === '木') {
                // 命中木：自再 +2（若天象火，则再 +1），目标 -2
                gg.scores[playerId].pub += 2 + fireBoost;
                gg.scores[targetId].pub -= 2;
                gg.logs.push(`🔥 ${pname} 展示了【火】，灼烧${tname}成功（${pname}+${2 + fireBoost}明分，${tname}-2明分）`);
              } else {
                // 未命中：自再 -1，目标 +1（若天象火，则目标额外 +1）
                gg.scores[playerId].pub -= 1;
                gg.scores[targetId].pub += 1 + fireBoost;
                gg.logs.push(`🔥 ${pname} 展示了【火】，灼烧${tname}失败（${pname}-1明分，${tname}+${1 + fireBoost}明分）`);
              }
              gg.castIdx += 1;
              break;
            }
            case '土': {
              const initHolder = gg.initialHolder['土'];
              if (initHolder !== playerId) {
                gg.logs.push(`⛰️ ${pname} 尝试展示【土】，但不是本回合初始持有者（无效）`);
                return; // 不前进
              }
              const add = 3 + (omen === '土' ? 1 : 0);
              gg.scores[playerId].pub += add;
              gg.logs.push(`⛰️ ${pname} 展示了【土】，+${add} 明分（初始持有者）`);
              gg.castIdx += 1;
              break;
            }
            case '贤': {
              gg.logs.push(`🧠 【贤】不可展示（请由主持人点击跳过以结算暗分）`);
              return;
            }
            case '愚': {
              gg.logs.push(`🃏 【愚】不可展示（无主动效果）`);
              return;
            }
          }
        }

        // —— 土后自动跑完“贤/愚” —— //
        const runAutoSageFool = () => {
          const omen2: Stone | null = gg.omenStone ?? null;
          while (gg.castIdx < ORDER.length) {
            const st = ORDER[gg.castIdx];
            if (st === '贤') {
              const add = 2 + (omen2 === '贤' ? 1 : 0);
              gg.logs.push(`➡️ 轮到【贤】发动`);
              gg.logs.push(`🧠 【贤】不公开（持有者 +${add} 暗分)`);
              const holder = gg.players.find(p => gg.hands[p.id] === '贤');
              if (holder) gg.scores[holder.id].sec += add;
              gg.castIdx += 1;
              continue;
            }
            if (st === '愚') {
              gg.logs.push(`➡️ 轮到【愚】发动`);
              gg.logs.push(`🃏 【愚】不公开（回合初始持有者+${omen2==='愚'?2:1}暗分，回合最终持有者-2暗分)`);
              gg.castIdx += 1;
              continue;
            }
            break;
          }
        };

        if (stone === '土') {
          runAutoSageFool();
        } else if (gg.castIdx < ORDER.length) {
          gg.logs.push(`➡️ 轮到【${ORDER[gg.castIdx]}】发动`);
        }

        if (gg.castIdx >= ORDER.length) {
          const fHolder = gg.players.find(p => gg.hands[p.id] === '愚');
          if (fHolder) gg.scores[fHolder.id].sec -= 2; // 不受天象影响
          gg.logs.push(`✅ 第 ${gg.round} 回合施法结束`);
          gg.phase = 'select';
          gg.round += 1;
          endOfRound = true;
        }
      });

      if (endOfRound) {
        const s = get();
        const threshold = s.endThreshold;
        const g = s.game!;
        const hitPlayers = g.players.filter(p => g.scores[p.id].pub >= threshold);

        if (hitPlayers.length > 0) {
          set(state => {
            const gg = state.game!;
            const trigger = [...hitPlayers].sort((a,b)=>g.scores[b.id].pub - g.scores[a.id].pub)[0];
            gg.logs.push(`🏁 终局触发：${trigger.name} 的明分达到 ${threshold} 分（≥ 阈值）`);

            const sage = gg.players.find(p => gg.hands[p.id] === '贤');
            if (sage) {
              gg.scores[sage.id].pub += 2; // 终局不受天象影响
              gg.logs.push(`🧠 终局：${sage.name} 最终持有【贤】，+2 明分`);
            } else {
              gg.logs.push(`🧠 终局：无人最终持有【贤】（无加成）`);
            }

            const fool = gg.players.find(p => p.isFool);
            if (fool) {
              const hasF = gg.hands[fool.id] === '愚';
              gg.scores[fool.id].pub += hasF ? 10 : -5; // 终局不受天象影响
              gg.logs.push(
                hasF
                  ? `🃏 终局：${fool.name} 为愚者，且最终持有【愚】（+10 明分）`
                  : `🃏 终局：${fool.name} 为愚者，但未持有【愚】（-5 明分）`
              );
            }

            const rows = gg.players.map(p => {
              const pub = gg.scores[p.id].pub;
              const sec = gg.scores[p.id].sec;
              const total = pub + sec;
              return { playerId: p.id, name: p.name, pub, sec, total };
            }).sort((a,b) => {
              if (b.total !== a.total) return b.total - a.total;
              if (b.pub !== a.pub) return b.pub - a.pub;
              const ai = gg.order.indexOf(a.playerId);
              const bi = gg.order.indexOf(b.playerId);
              return bi - ai;
            });

            const rewards = [100,50,30,10,10];
            const finalRanks: FinalRankRow[] = rows.map((r, i) => ({
              ...r, place: i+1, reward: rewards[i] ?? 10
            }));

            state.isOver = true;
            state.finalRanks = finalRanks;
            gg.logs.push(`🏆 终局结算完成（已生成排名）`);
          });
        } else {
          get().startRound();
        }
      }
    },

    // —— 愚者捉弄（整局一次） —— //
    foolPrank: () => {
      set(state => {
        if (state.foolPrankUsed) return;
        const gg = state.game!;
        const seed = gg.seed + '#prank#' + gg.round + '#' + Date.now().toString();
        const newMap = Object.fromEntries(
          shuffle(seed, STONES).map((st, i) => [i + 1, st])
        ) as Record<number, Stone>;
        state.nextFlaskMap = newMap;
        state.foolPrankUsed = true;
        // 不公开日志
      });
    },

    exportSnapshot: () => {
      const state = get();
      return {
        game: state.game ? deepCopy(state.game) : null,
        endThreshold: state.endThreshold,
        isOver: state.isOver,
        finalRanks: state.finalRanks ? deepCopy(state.finalRanks) : null,
        flaskMap: state.flaskMap ? deepCopy(state.flaskMap) : null,
        nextFlaskMap: state.nextFlaskMap ? deepCopy(state.nextFlaskMap) : null,
        foolPrankUsed: state.foolPrankUsed,
        roundStartScores: state.roundStartScores ? deepCopy(state.roundStartScores) : null,
      } satisfies GameSnapshot;
    },

    applySnapshot: (snapshot) => {
      set(state => {
        state.endThreshold = snapshot.endThreshold;
        state.isOver = snapshot.isOver;
        state.finalRanks = snapshot.finalRanks ? deepCopy(snapshot.finalRanks) : null;
        state.flaskMap = snapshot.flaskMap ? deepCopy(snapshot.flaskMap) : null;
        state.nextFlaskMap = snapshot.nextFlaskMap ? deepCopy(snapshot.nextFlaskMap) : null;
        state.foolPrankUsed = snapshot.foolPrankUsed;
        state.roundStartScores = snapshot.roundStartScores ? deepCopy(snapshot.roundStartScores) : null;
        state.game = snapshot.game ? deepCopy(snapshot.game) : null;
      });
    },
  }))
);

export const exportSnapshot = () => useGame.getState().exportSnapshot();
export const applySnapshot = (snapshot: GameSnapshot) => useGame.getState().applySnapshot(snapshot);

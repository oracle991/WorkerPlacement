import type { Difficulty, DifficultyId } from '../core/types';

/**
 * 難易度定義。PLAN.md セクション5の方針どおり「目標繁栄度」と「イベントの過酷さ」を変える。
 * バランス調整をコード変更なしで行えるよう、ここに数値を集約する。
 *
 * - targetProsperity: クリア条件となる繁栄度。
 * - harshEventChance / kindEventChance: 準備フェーズで抽選したラウンドイベントを、
 *   過酷な方(Hard)/和らげた方(Easy)へ引き直す確率。過酷さは既存の events.ts の
 *   仕組み(難易度補正・維持食料増)に自然に載る形で実現する。
 * - startResourceDelta: 開始時の資源補正。
 *
 * Normal は現行バランスと完全に同一(目標30・引き直しなし・資源補正なし)。
 * 引き直し確率が 0 のときは RNG を一切消費しないため、Normal の抽選結果は従来と一致する。
 */
export const difficulties: Record<DifficultyId, Difficulty> = {
  easy: {
    id: 'easy',
    label: 'やさしい',
    description: '目標繁栄度は低め。過酷なイベントは和らぎ、食料の蓄えも多い。',
    targetProsperity: 24,
    harshEventChance: 0,
    kindEventChance: 0.5,
    startResourceDelta: { food: 2 },
  },
  normal: {
    id: 'normal',
    label: 'ふつう',
    description: '標準のバランス。目標繁栄度は30。',
    targetProsperity: 30,
    harshEventChance: 0,
    kindEventChance: 0,
    startResourceDelta: {},
  },
  hard: {
    id: 'hard',
    label: 'きびしい',
    description: '目標繁栄度は高め。過酷なイベントが増え、備蓄計画がより厳しく問われる。',
    targetProsperity: 36,
    harshEventChance: 0.5,
    kindEventChance: 0,
    startResourceDelta: {},
  },
};

/** タイトル画面などで表示する順序(易→難) */
export const difficultyOrder: DifficultyId[] = ['easy', 'normal', 'hard'];

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

export function getDifficulty(id: DifficultyId): Difficulty {
  return difficulties[id];
}

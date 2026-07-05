import type { Stat, TraitId, Worker } from '../core/types';

export const initialWorkers: Worker[] = [
  {
    id: 'mina',
    name: 'ミナ',
    icon: '💪',
    stats: { strength: 4, dexterity: 2, wisdom: 2, charm: 3 },
    traits: ['mighty'],
    fatigue: 0,
    injured: 0,
    xp: 0,
    level: 0,
  },
  {
    id: 'toma',
    name: 'トーマ',
    icon: '🛠️',
    stats: { strength: 2, dexterity: 4, wisdom: 3, charm: 2 },
    traits: ['crafty'],
    fatigue: 0,
    injured: 0,
    xp: 0,
    level: 0,
  },
  {
    id: 'luca',
    name: 'ルカ',
    icon: '🗣️',
    stats: { strength: 2, dexterity: 2, wisdom: 3, charm: 4 },
    traits: ['social', 'lucky'],
    fatigue: 0,
    injured: 0,
    xp: 0,
    level: 0,
  },
];

/** 勧誘で生成されるワーカーの名前と顔の候補 */
export const recruitNames: Array<{ name: string; icon: string }> = [
  { name: 'サラ', icon: '📚' },
  { name: 'グレン', icon: '🛡️' },
  { name: 'ノノ', icon: '🍀' },
  { name: 'バルド', icon: '🪓' },
  { name: 'エマ', icon: '🌸' },
  { name: 'ロイ', icon: '🎯' },
  { name: 'ハンナ', icon: '🕯️' },
  { name: 'ギド', icon: '🍺' },
  { name: 'リゼ', icon: '🦉' },
  { name: 'オルガ', icon: '🔥' },
];

/** 勧誘ワーカーのステータス配列候補(シャッフルして4ステータスへ割り当てる) */
export const recruitStatLines: number[][] = [
  [4, 3, 2, 2],
  [4, 4, 2, 1],
  [3, 3, 3, 2],
  [5, 2, 2, 1],
  [3, 3, 2, 2],
];

/** 勧誘で付く可能性のあるプラス個性 */
export const recruitPositiveTraits: TraitId[] = [
  'mighty',
  'crafty',
  'sage',
  'charming',
  'careful',
  'lucky',
  'social',
  'sturdy',
  'hardworking',
  'merchant',
];

/** 勧誘で混じる可能性のあるマイナス個性(外れワーカー) */
export const recruitNegativeTraits: TraitId[] = ['timid', 'lazy', 'frail'];

export const statOrder: Stat[] = ['strength', 'dexterity', 'wisdom', 'charm'];

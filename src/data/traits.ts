import type { TraitContext, TraitId, Worker } from '../core/types';

export interface TraitDefinition {
  id: TraitId;
  name: string;
  description: string;
  negative: boolean;
  bonus: (context: TraitContext) => number;
}

export const traits: Record<TraitId, TraitDefinition> = {
  mighty: {
    id: 'mighty',
    name: '怪力',
    description: '筋力判定 +1',
    negative: false,
    bonus: ({ spot }) => (spot.stat === 'strength' ? 1 : 0),
  },
  crafty: {
    id: 'crafty',
    name: '手先器用',
    description: '器用判定 +1',
    negative: false,
    bonus: ({ spot }) => (spot.stat === 'dexterity' ? 1 : 0),
  },
  sage: {
    id: 'sage',
    name: '博識',
    description: '知恵判定 +1',
    negative: false,
    bonus: ({ spot }) => (spot.stat === 'wisdom' ? 1 : 0),
  },
  charming: {
    id: 'charming',
    name: '愛嬌',
    description: '魅力判定 +1',
    negative: false,
    bonus: ({ spot }) => (spot.stat === 'charm' ? 1 : 0),
  },
  careful: {
    id: 'careful',
    name: '慎重',
    description: '難易度9以上のスポットで +1',
    negative: false,
    bonus: ({ difficulty }) => (difficulty >= 9 ? 1 : 0),
  },
  lucky: {
    id: 'lucky',
    name: '幸運',
    description: '大失敗を失敗へ軽減',
    negative: false,
    bonus: () => 0,
  },
  social: {
    id: 'social',
    name: '社交的',
    description: '同じスポットに相方がいると +1',
    negative: false,
    bonus: ({ worker, spot, assignments }) =>
      assignments.some((assignment) => assignment.spotId === spot.id && assignment.workerId !== worker.id) ? 1 : 0,
  },
  sturdy: {
    id: 'sturdy',
    name: '頑丈',
    description: '負傷する確率が半分',
    negative: false,
    bonus: () => 0,
  },
  hardworking: {
    id: 'hardworking',
    name: '働き者',
    description: '疲労の蓄積が半分(切り捨て)',
    negative: false,
    bonus: () => 0,
  },
  merchant: {
    id: 'merchant',
    name: '商才',
    description: '市場で判定 +1、売却金貨 +1',
    negative: false,
    bonus: ({ spot }) => (spot.id === 'market' ? 1 : 0),
  },
  timid: {
    id: 'timid',
    name: '臆病',
    description: '難易度9以上のスポットで -1',
    negative: true,
    bonus: ({ difficulty }) => (difficulty >= 9 ? -1 : 0),
  },
  lazy: {
    id: 'lazy',
    name: '怠け者',
    description: '疲労が 1 多く溜まる',
    negative: true,
    bonus: () => 0,
  },
  frail: {
    id: 'frail',
    name: '病弱',
    description: '負傷する確率が2倍',
    negative: true,
    bonus: () => 0,
  },
};

export function traitNames(worker: Worker): string {
  return worker.traits.map((id) => traits[id].name).join(' / ');
}

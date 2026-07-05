import type { Spot, TraitContext, TraitId, Worker } from '../core/types';

export interface TraitDefinition {
  id: TraitId;
  name: string;
  description: string;
  bonus: (context: TraitContext) => number;
  afterOutcome?: (worker: Worker, spot: Spot, margin: number) => string | undefined;
}

export const traits: Record<TraitId, TraitDefinition> = {
  mighty: {
    id: 'mighty',
    name: '怪力',
    description: '筋力判定 +1',
    bonus: ({ spot }) => (spot.stat === 'strength' ? 1 : 0),
  },
  careful: {
    id: 'careful',
    name: '慎重',
    description: '難易度9以上のスポットで +1',
    bonus: ({ spot }) => (spot.difficulty >= 9 ? 1 : 0),
  },
  lucky: {
    id: 'lucky',
    name: '幸運',
    description: '大失敗を失敗へ軽減',
    bonus: () => 0,
  },
  social: {
    id: 'social',
    name: '社交的',
    description: '集会所と市場で +1',
    bonus: ({ spot }) => (spot.id === 'hall' || spot.id === 'market' ? 1 : 0),
  },
  sturdy: {
    id: 'sturdy',
    name: '頑丈',
    description: '鉱山と遺跡で +1',
    bonus: ({ spot }) => (spot.id === 'mine' || spot.id === 'ruins' ? 1 : 0),
  },
  crafty: {
    id: 'crafty',
    name: '手先器用',
    description: '器用判定 +1',
    bonus: ({ spot }) => (spot.stat === 'dexterity' ? 1 : 0),
  },
};

export function traitNames(worker: Worker): string {
  return worker.traits.map((id) => traits[id].name).join(' / ');
}

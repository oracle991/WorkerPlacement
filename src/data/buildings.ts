import type { Building } from '../core/types';

/**
 * 工房で建設できる施設。資源(木材/鉱石/金貨)を消費して
 * 繁栄度とパッシブ効果を得る。各施設は1回だけ建設できる。
 */
export const buildings: Building[] = [
  {
    id: 'storehouse',
    name: '倉庫',
    icon: '🏚️',
    cost: { wood: 3 },
    prosperity: 2,
    effects: { foodUpkeepSaving: 1 },
    description: '維持フェーズの食料消費 -1。',
  },
  {
    id: 'sawmill',
    name: '製材所',
    icon: '🪚',
    cost: { wood: 3, ore: 1 },
    prosperity: 3,
    effects: { spotBonus: { spotId: 'forest', resource: 'wood', amount: 1 } },
    description: '森林の成功時、木材 +1。',
  },
  {
    id: 'mill',
    name: '水車小屋',
    icon: '🌀',
    cost: { wood: 3, gold: 1 },
    prosperity: 3,
    effects: { spotBonus: { spotId: 'farm', resource: 'food', amount: 1 } },
    description: '農場の成功時、食料 +1。',
  },
  {
    id: 'tradepost',
    name: '交易所',
    icon: '🏪',
    cost: { wood: 1, gold: 2 },
    prosperity: 3,
    effects: { marketGoldBonus: 1 },
    description: '市場の売却時、金貨 +1。',
  },
  {
    id: 'inn',
    name: '宿屋',
    icon: '🏨',
    cost: { wood: 2, gold: 2 },
    prosperity: 3,
    effects: { fatigueRecoveryBonus: 1 },
    description: '維持フェーズの疲労回復 +1。',
  },
  {
    id: 'clinic',
    name: '診療所',
    icon: '🏥',
    cost: { wood: 1, ore: 1, gold: 2 },
    prosperity: 3,
    effects: { injuryRecoveryBonus: 1 },
    description: '負傷の回復が2倍の速さになる。',
  },
  {
    id: 'forge',
    name: '鍛冶場',
    icon: '⚒️',
    cost: { wood: 1, ore: 3 },
    prosperity: 4,
    effects: { spotBonus: { spotId: 'mine', resource: 'ore', amount: 1 } },
    description: '鉱山の成功時、鉱石 +1。',
  },
  {
    id: 'monument',
    name: '記念碑',
    icon: '🗿',
    cost: { ore: 4, gold: 3 },
    prosperity: 7,
    effects: {},
    description: '村の誇り。大きな繁栄度をもたらす。',
  },
];

export function getBuilding(id: string): Building | undefined {
  return buildings.find((building) => building.id === id);
}

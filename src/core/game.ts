import { buildings, getBuilding } from '../data/buildings';
import { DEFAULT_DIFFICULTY, getDifficulty } from '../data/difficulties';
import { eventTable } from '../data/events';
import { seasonIcons, seasonLabels, seasonNotes, seasons } from '../data/seasons';
import { spots } from '../data/spots';
import { traits } from '../data/traits';
import {
  initialWorkers,
  recruitNames,
  recruitNegativeTraits,
  recruitPositiveTraits,
  recruitStatLines,
  statOrder,
} from '../data/workers';
import { Rng, seedFromText } from './rng';
import type {
  Assignment,
  Building,
  Difficulty,
  DifficultyId,
  GameState,
  Outcome,
  Resource,
  Resources,
  ResolutionResult,
  RoundEvent,
  RoundPreview,
  Season,
  Spot,
  SpotReward,
  Stat,
  TraitId,
  Worker,
} from './types';

const statLabels: Record<Stat, string> = {
  strength: '筋力',
  dexterity: '器用',
  wisdom: '知恵',
  charm: '魅力',
};

const outcomeLabels: Record<Outcome, string> = {
  criticalSuccess: '大成功',
  success: '成功',
  failure: '失敗',
  criticalFailure: '大失敗',
};

export const MAX_WORKERS = 5;
export const HIRE_COST_GOLD = 2;
export const XP_PER_LEVEL = 5;
export const FOOD_PURCHASE_GOLD = 2;
export const MARKET_SALE_LIMIT = 2;
const FATIGUE_LEAVE_THRESHOLD = 8;

export function createGame(seedText = String(Date.now()), difficultyId: DifficultyId = DEFAULT_DIFFICULTY): GameState {
  const seed = seedFromText(seedText);
  const difficulty = getDifficulty(difficultyId);
  const resources: Resources = { food: 8, wood: 3, ore: 1, gold: 2, prosperity: 0 };
  for (const [resource, delta] of Object.entries(difficulty.startResourceDelta) as Array<[Resource, number]>) {
    resources[resource] += delta;
  }
  return {
    seed,
    round: 1,
    maxRounds: 12,
    targetProsperity: difficulty.targetProsperity,
    difficultyId,
    phase: 'title',
    workers: cloneWorkers(initialWorkers),
    resources,
    assignments: [],
    builtBuildingIds: [],
    log: ['開拓団が辺境の村へ到着した。'],
    preview: buildPreview(1, seed, difficulty),
    lastResults: [],
    winner: false,
    gameOver: false,
  };
}

export function startGame(state: GameState): GameState {
  return {
    ...state,
    phase: 'prepare',
    preview: buildPreview(state.round, state.seed, getDifficulty(state.difficultyId)),
  };
}

export function beginPlacement(state: GameState): GameState {
  if (state.gameOver) return state;
  const preview = buildPreview(state.round, state.seed, getDifficulty(state.difficultyId));
  const resources = { ...state.resources };
  const log: string[] = [];
  for (const gain of preview.event.effects.immediate ?? []) {
    resources[gain.resource] += gain.amount;
    log.push(`${preview.event.name}: ${resourceLabel(gain.resource)} +${gain.amount}`);
  }
  return {
    ...state,
    phase: 'placement',
    assignments: [],
    resources,
    preview,
    log: [
      ...log,
      `ラウンド${state.round} [${preview.seasonLabel}] ${preview.event.name}: ${preview.event.description}`,
      ...state.log,
    ].slice(0, 40),
  };
}

export function assignWorker(state: GameState, workerId: string, spotId: string, buildingId?: string): GameState {
  const spot = getSpot(spotId);
  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker || !spot || !isSpotUnlocked(spot, state.round) || worker.injured > 0) return state;
  if (state.assignments.some((assignment) => assignment.workerId === workerId)) return state;
  if (state.assignments.filter((assignment) => assignment.spotId === spotId).length >= spot.capacity) return state;
  if (buildingId) {
    const building = getBuilding(buildingId);
    if (!building || spot.id !== 'workshop') return state;
    if (state.builtBuildingIds.includes(buildingId)) return state;
  }
  return {
    ...state,
    assignments: [...state.assignments, { workerId, spotId, buildingId }],
  };
}

export function unassignWorker(state: GameState, workerId: string): GameState {
  return {
    ...state,
    assignments: state.assignments.filter((assignment) => assignment.workerId !== workerId),
  };
}

export function resolveAssignments(state: GameState): GameState {
  const rng = new Rng(state.seed + state.round * 101 + state.assignments.length * 17);
  const workers = cloneWorkers(state.workers);
  const resources = { ...state.resources };
  const builtBuildingIds = [...state.builtBuildingIds];
  const orderedAssignments = [...state.assignments].sort((a, b) => spotOrder(a.spotId) - spotOrder(b.spotId));
  const results = orderedAssignments.map((assignment) =>
    resolveOne(assignment, workers, resources, builtBuildingIds, state, rng),
  );
  const log = [
    ...results.map((result) => {
      const worker = workers.find((candidate) => candidate.id === result.workerId) ??
        state.workers.find((candidate) => candidate.id === result.workerId);
      const spot = getSpot(result.spotId);
      return `${worker?.name ?? '誰か'}: ${spot?.name ?? '不明'} ${outcomeLabels[result.outcome]} (${result.dice.join('+')} => ${result.total}/${result.target})`;
    }),
    ...state.log,
  ].slice(0, 40);

  return {
    ...state,
    phase: 'resolution',
    workers,
    resources,
    builtBuildingIds,
    lastResults: results,
    log,
  };
}

export function finishUpkeep(state: GameState): GameState {
  const resources = { ...state.resources };
  const season = getSeason(state.round);
  const effects = builtEffects(state.builtBuildingIds);
  const log: string[] = [];

  const fatigueRecovery = (season === 'summer' ? 0 : 1) + effects.fatigueRecoveryBonus;
  const injuryRecovery = 1 + effects.injuryRecoveryBonus;
  let workers = cloneWorkers(state.workers).map((worker) => {
    const rested = !state.assignments.some((assignment) => assignment.workerId === worker.id) && worker.injured === 0;
    return {
      ...worker,
      fatigue: Math.max(0, worker.fatigue - fatigueRecovery - (rested ? 1 : 0)),
      injured: Math.max(0, worker.injured - injuryRecovery),
    };
  });

  let foodCost = workers.length + (season === 'winter' ? 1 : 0) + (state.preview.event.effects.upkeepFoodDelta ?? 0);
  foodCost = Math.max(0, foodCost - effects.foodUpkeepSaving);
  resources.food -= foodCost;
  log.push(`維持: 食料 ${foodCost} 消費`);
  if (season === 'autumn') {
    resources.food += 1;
    log.push('収穫の季節: 食料 +1');
  }

  if (resources.food < 0) {
    const shortage = -resources.food;
    const purchasable = Math.min(shortage, Math.floor(resources.gold / FOOD_PURCHASE_GOLD));
    if (purchasable > 0) {
      resources.gold -= purchasable * FOOD_PURCHASE_GOLD;
      resources.food += purchasable;
      log.push(`不足分の食料 ${purchasable} を金貨 ${purchasable * FOOD_PURCHASE_GOLD} で購入`);
    }
  }
  if (resources.food < 0) {
    const shortage = -resources.food;
    resources.food = 0;
    workers = workers.map((worker) => ({ ...worker, fatigue: worker.fatigue + 2 }));
    const leavers = workers.filter((worker) => worker.fatigue >= FATIGUE_LEAVE_THRESHOLD);
    workers = workers.filter((worker) => worker.fatigue < FATIGUE_LEAVE_THRESHOLD);
    log.push(`食料不足 ${shortage}: 全員の疲労 +2`);
    for (const leaver of leavers) log.push(`${leaver.name} は限界を迎え、村を去った…`);
  }

  const noWorkers = workers.length === 0;
  const lastRound = state.round >= state.maxRounds;
  const winner = resources.prosperity >= state.targetProsperity;
  const gameOver = noWorkers || lastRound || winner;

  return {
    ...state,
    phase: gameOver ? 'result' : 'prepare',
    round: gameOver ? state.round : state.round + 1,
    workers,
    resources,
    assignments: [],
    preview: buildPreview(gameOver ? state.round : state.round + 1, state.seed, getDifficulty(state.difficultyId)),
    winner,
    gameOver,
    log: [...log, ...state.log].slice(0, 40),
  };
}

export function getSeason(round: number): Season {
  return seasons[Math.min(seasons.length - 1, Math.floor((round - 1) / 3))];
}

export function buildPreview(
  round: number,
  seed: number,
  difficulty: Difficulty = getDifficulty(DEFAULT_DIFFICULTY),
): RoundPreview {
  const season = getSeason(round);
  const pool = eventTable[season];
  const rng = new Rng(seed + round * 7919);
  const event = biasEventForDifficulty(pool[rng.int(0, pool.length - 1)], pool, difficulty, rng);
  return {
    season,
    seasonLabel: `${seasonIcons[season]}${seasonLabels[season]}`,
    seasonNote: seasonNotes[season],
    event,
    unlockedSpotIds: spots.filter((spot) => isSpotUnlocked(spot, round)).map((spot) => spot.id),
  };
}

export type EventTone = 'good' | 'bad' | 'neutral';

/**
 * ラウンドイベントの過酷さを分類する。
 * 「過酷(bad)」= スポット難易度を上げる or 維持食料を増やす効果を持つイベント。
 * 難易度による引き直しはこの分類を基準に行う。
 */
export function eventTone(event: RoundEvent): EventTone {
  const deltas = Object.values(event.effects.difficultyDelta ?? {});
  const upkeep = event.effects.upkeepFoodDelta ?? 0;
  if (deltas.some((delta) => delta > 0) || upkeep > 0) return 'bad';
  if (
    deltas.some((delta) => delta < 0) ||
    upkeep < 0 ||
    event.effects.spotBonus !== undefined ||
    (event.effects.immediate?.length ?? 0) > 0
  ) {
    return 'good';
  }
  return 'neutral';
}

/**
 * 難易度に応じてイベントを引き直す。
 * Hard: 過酷でないイベントを一定確率で過酷なイベントへ差し替える。
 * Easy: 過酷なイベントを一定確率で和らいだイベントへ差し替える。
 * どちらの確率も 0(=Normal)のときは RNG を消費せず、抽選結果は従来と一致する。
 */
function biasEventForDifficulty(
  event: RoundEvent,
  pool: RoundEvent[],
  difficulty: Difficulty,
  rng: Rng,
): RoundEvent {
  if (difficulty.harshEventChance > 0 && eventTone(event) !== 'bad' && rng.chance(difficulty.harshEventChance)) {
    const harsh = pool.filter((candidate) => eventTone(candidate) === 'bad');
    if (harsh.length > 0) return harsh[rng.int(0, harsh.length - 1)];
  }
  if (difficulty.kindEventChance > 0 && eventTone(event) === 'bad' && rng.chance(difficulty.kindEventChance)) {
    const kind = pool.filter((candidate) => eventTone(candidate) !== 'bad');
    if (kind.length > 0) return kind[rng.int(0, kind.length - 1)];
  }
  return event;
}

export function isSpotUnlocked(spot: Spot, round: number): boolean {
  const unlockIndex = seasons.indexOf(spot.unlockSeason);
  const seasonIndex = seasons.indexOf(getSeason(round));
  return seasonIndex >= unlockIndex;
}

/** ラウンドイベント補正込みのスポット難易度 */
export function effectiveDifficulty(spot: Spot, event: RoundEvent): number {
  return spot.difficulty + (event.effects.difficultyDelta?.[spot.id] ?? 0);
}

function fatiguePenalty(worker: Worker): number {
  return Math.floor(worker.fatigue / 2);
}

function checkModifier(worker: Worker, spot: Spot, assignments: Assignment[], difficulty: number): number {
  return worker.stats[spot.stat] + traitBonus(worker, spot, assignments, difficulty) - fatiguePenalty(worker);
}

export function successProbability(worker: Worker, spot: Spot, assignments: Assignment[] = [], event?: RoundEvent): number {
  const difficulty = event ? effectiveDifficulty(spot, event) : spot.difficulty;
  const modifier = checkModifier(worker, spot, assignments, difficulty);
  let wins = 0;
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (first + second + modifier >= difficulty) wins += 1;
    }
  }
  return Math.round((wins / 36) * 100);
}

export function statLabel(stat: Stat): string {
  return statLabels[stat];
}

export function outcomeLabel(outcome: Outcome): string {
  return outcomeLabels[outcome];
}

export function getSpot(id: string): Spot | undefined {
  return spots.find((spot) => spot.id === id);
}

export function availableSpots(round: number): Spot[] {
  return spots.filter((spot) => isSpotUnlocked(spot, round));
}

/** まだ建っておらず、他の配置予定にもなっていない施設 */
export function availableBuildings(state: GameState): Building[] {
  return buildings.filter(
    (building) =>
      !state.builtBuildingIds.includes(building.id) &&
      !state.assignments.some((assignment) => assignment.buildingId === building.id),
  );
}

export function canAfford(resources: Resources, cost: Partial<Record<Resource, number>>): boolean {
  return (Object.entries(cost) as Array<[Resource, number]>).every(([resource, amount]) => resources[resource] >= amount);
}

export function costLabel(cost: Partial<Record<Resource, number>>): string {
  return (Object.entries(cost) as Array<[Resource, number]>)
    .map(([resource, amount]) => `${resourceLabel(resource)}${amount}`)
    .join(' ');
}

interface BuiltEffectsSummary {
  foodUpkeepSaving: number;
  fatigueRecoveryBonus: number;
  injuryRecoveryBonus: number;
  marketGoldBonus: number;
  spotBonuses: Array<{ spotId: string; resource: Resource; amount: number }>;
}

function builtEffects(builtBuildingIds: string[]): BuiltEffectsSummary {
  const summary: BuiltEffectsSummary = {
    foodUpkeepSaving: 0,
    fatigueRecoveryBonus: 0,
    injuryRecoveryBonus: 0,
    marketGoldBonus: 0,
    spotBonuses: [],
  };
  for (const id of builtBuildingIds) {
    const building = getBuilding(id);
    if (!building) continue;
    summary.foodUpkeepSaving += building.effects.foodUpkeepSaving ?? 0;
    summary.fatigueRecoveryBonus += building.effects.fatigueRecoveryBonus ?? 0;
    summary.injuryRecoveryBonus += building.effects.injuryRecoveryBonus ?? 0;
    summary.marketGoldBonus += building.effects.marketGoldBonus ?? 0;
    if (building.effects.spotBonus) summary.spotBonuses.push(building.effects.spotBonus);
  }
  return summary;
}

function resolveOne(
  assignment: Assignment,
  workers: Worker[],
  resources: Resources,
  builtBuildingIds: string[],
  state: GameState,
  rng: Rng,
): ResolutionResult {
  const worker = workers.find((candidate) => candidate.id === assignment.workerId);
  const spot = getSpot(assignment.spotId);
  if (!worker || !spot) {
    return { ...emptyResult(assignment), notes: ['配置先を解決できませんでした。'] };
  }

  const difficulty = effectiveDifficulty(spot, state.preview.event);
  const dice: [number, number] = [rng.int(1, 6), rng.int(1, 6)];
  const modifier = checkModifier(worker, spot, state.assignments, difficulty);
  const total = dice[0] + dice[1] + modifier;
  const margin = total - difficulty;
  let outcome = determineOutcome(dice, margin);
  const notes: string[] = [];

  if (outcome === 'criticalFailure' && worker.traits.includes('lucky')) {
    outcome = 'failure';
    notes.push('幸運で大失敗を回避');
  }

  const succeeded = outcome === 'success' || outcome === 'criticalSuccess';
  const rewards: SpotReward[] = [];
  const spent: SpotReward[] = [];

  if (spot.id === 'workshop' && assignment.buildingId) {
    resolveConstruction(assignment.buildingId, outcome, resources, builtBuildingIds, rewards, spent, notes);
  } else {
    rewards.push(...applySeasonToRewards(spot, outcome, state.round));
    if (succeeded) {
      const event = state.preview.event.effects.spotBonus;
      if (event && event.spotId === spot.id) rewards.push({ resource: event.resource, amount: event.amount });
      for (const bonus of builtEffects(builtBuildingIds).spotBonuses) {
        if (bonus.spotId === spot.id) rewards.push({ resource: bonus.resource, amount: bonus.amount });
      }
    }
  }

  if (spot.id === 'market' && succeeded) {
    resolveMarketSale(worker, outcome, resources, builtBuildingIds, rewards, spent, notes);
  }

  if (spot.id === 'hall' && succeeded) {
    resolveRecruit(outcome, workers, resources, spent, notes, rng);
  }

  applyRewards(resources, rewards);
  applyCosts(resources, spent);

  if (spot.id === 'shrine' && succeeded) {
    worker.fatigue = 0;
    notes.push(`${worker.name}の疲労が全快`);
    if (outcome === 'criticalSuccess') {
      for (const ally of workers) ally.fatigue = Math.max(0, ally.fatigue - 2);
      notes.push('全員の疲労 -2');
    }
  }

  gainXp(worker, spot, outcome, notes);
  applyFatigue(worker, spot, outcome);
  resolveInjury(worker, spot, outcome, notes, rng);

  return {
    workerId: worker.id,
    spotId: spot.id,
    dice,
    total,
    target: difficulty,
    outcome,
    rewards,
    spent,
    notes,
  };
}

function resolveConstruction(
  buildingId: string,
  outcome: Outcome,
  resources: Resources,
  builtBuildingIds: string[],
  rewards: SpotReward[],
  spent: SpotReward[],
  notes: string[],
): void {
  const building = getBuilding(buildingId);
  const succeeded = outcome === 'success' || outcome === 'criticalSuccess';
  if (!building || builtBuildingIds.includes(buildingId)) return;
  if (!succeeded) {
    notes.push(`${building.name}の建設は進まなかった`);
    return;
  }
  if (!canAfford(resources, building.cost)) {
    notes.push(`資源不足で${building.name}を建てられず(修繕のみ)`);
    rewards.push({ resource: 'prosperity', amount: 1 });
    return;
  }
  for (const [resource, amount] of Object.entries(building.cost) as Array<[Resource, number]>) {
    spent.push({ resource, amount });
  }
  builtBuildingIds.push(building.id);
  rewards.push({ resource: 'prosperity', amount: building.prosperity + (outcome === 'criticalSuccess' ? 1 : 0) });
  notes.push(`${building.icon}${building.name}を建設!(${building.description})`);
}

function resolveMarketSale(
  worker: Worker,
  outcome: Outcome,
  resources: Resources,
  builtBuildingIds: string[],
  rewards: SpotReward[],
  spent: SpotReward[],
  notes: string[],
): void {
  const rate = outcome === 'criticalSuccess' ? 2 : 1;
  const woodSold = Math.min(MARKET_SALE_LIMIT, resources.wood);
  const oreSold = Math.min(MARKET_SALE_LIMIT, resources.ore);
  const unitsSold = woodSold + oreSold;
  if (unitsSold === 0) {
    notes.push('売る資源がなかった');
    return;
  }
  if (woodSold > 0) spent.push({ resource: 'wood', amount: woodSold });
  if (oreSold > 0) spent.push({ resource: 'ore', amount: oreSold });
  let gold = unitsSold * rate + builtEffects(builtBuildingIds).marketGoldBonus;
  if (worker.traits.includes('merchant')) {
    gold += 1;
    notes.push('商才で金貨 +1');
  }
  rewards.push({ resource: 'gold', amount: gold });
  notes.push(`木材${woodSold}・鉱石${oreSold}を売却`);
}

function resolveRecruit(
  outcome: Outcome,
  workers: Worker[],
  resources: Resources,
  spent: SpotReward[],
  notes: string[],
  rng: Rng,
): void {
  if (workers.length >= MAX_WORKERS) {
    notes.push('これ以上仲間を養えない(定員5人)');
    return;
  }
  const free = outcome === 'criticalSuccess';
  if (!free && resources.gold < HIRE_COST_GOLD) {
    notes.push(`雇う金貨が足りない(金貨${HIRE_COST_GOLD}が必要)`);
    return;
  }
  const recruit = generateRecruit(rng, workers);
  if (!recruit) {
    notes.push('新しい人手は見つからなかった');
    return;
  }
  if (!free) {
    spent.push({ resource: 'gold', amount: HIRE_COST_GOLD });
  }
  workers.push(recruit);
  notes.push(`${recruit.icon}${recruit.name}が加入${free ? '(無料!)' : ''}`);
}

function generateRecruit(rng: Rng, workers: Worker[]): Worker | undefined {
  const candidates = recruitNames.filter((entry) => !workers.some((worker) => worker.name === entry.name));
  if (candidates.length === 0) return undefined;
  const identity = candidates[rng.int(0, candidates.length - 1)];
  const statLine = [...recruitStatLines[rng.int(0, recruitStatLines.length - 1)]];
  const stats: Record<Stat, number> = { strength: 1, dexterity: 1, wisdom: 1, charm: 1 };
  const order = [...statOrder];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((stat, index) => {
    stats[stat] = statLine[index];
  });
  const workerTraits: TraitId[] = [recruitPositiveTraits[rng.int(0, recruitPositiveTraits.length - 1)]];
  if (rng.chance(0.35)) {
    workerTraits.push(recruitNegativeTraits[rng.int(0, recruitNegativeTraits.length - 1)]);
  }
  return {
    id: `recruit-${identity.name}-${rng.int(1000, 9999)}`,
    name: identity.name,
    icon: identity.icon,
    stats,
    traits: workerTraits,
    fatigue: 0,
    injured: 0,
    xp: 0,
    level: 0,
  };
}

function gainXp(worker: Worker, spot: Spot, outcome: Outcome, notes: string[]): void {
  worker.xp += outcome === 'criticalSuccess' ? 2 : outcome === 'success' ? 1 : 0;
  while (worker.xp >= XP_PER_LEVEL) {
    worker.xp -= XP_PER_LEVEL;
    worker.level += 1;
    if (worker.stats[spot.stat] < 5) {
      worker.stats[spot.stat] += 1;
      notes.push(`${worker.name}が成長! ${statLabels[spot.stat]} +1`);
    } else {
      const lowest = statOrder.reduce((min, stat) => (worker.stats[stat] < worker.stats[min] ? stat : min), statOrder[0]);
      worker.stats[lowest] = Math.min(5, worker.stats[lowest] + 1);
      notes.push(`${worker.name}が成長! ${statLabels[lowest]} +1`);
    }
  }
}

function applyFatigue(worker: Worker, spot: Spot, outcome: Outcome): void {
  let gain = spot.risk.fatigue + (outcome === 'criticalFailure' ? 1 : 0);
  if (worker.traits.includes('hardworking')) gain = Math.floor(gain / 2);
  if (worker.traits.includes('lazy')) gain += 1;
  worker.fatigue += gain;
}

function resolveInjury(worker: Worker, spot: Spot, outcome: Outcome, notes: string[], rng: Rng): void {
  if (outcome !== 'failure' && outcome !== 'criticalFailure') return;
  let chance = spot.risk.injuryChance * (outcome === 'criticalFailure' ? 2 : 1);
  if (worker.traits.includes('sturdy')) chance /= 2;
  if (worker.traits.includes('frail')) chance *= 2;
  if (rng.chance(chance)) {
    worker.injured = 2;
    notes.push(`${worker.name}が負傷(2ラウンド行動不能)`);
  }
}

function traitBonus(worker: Worker, spot: Spot, assignments: Assignment[], difficulty: number): number {
  return worker.traits.reduce(
    (sum, traitId) => sum + traits[traitId].bonus({ worker, spot, assignments, difficulty }),
    0,
  );
}

function determineOutcome(dice: [number, number], margin: number): Outcome {
  if (dice[0] === 1 && dice[1] === 1) return 'criticalFailure';
  if (dice[0] === 6 && dice[1] === 6) return 'criticalSuccess';
  if (margin >= 4) return 'criticalSuccess';
  if (margin >= 0) return 'success';
  if (margin <= -5) return 'criticalFailure';
  return 'failure';
}

function applySeasonToRewards(spot: Spot, outcome: Outcome, round: number): SpotReward[] {
  const season = getSeason(round);
  return spot.rewards[outcome].map((reward) => {
    if (spot.id === 'farm' && reward.resource === 'food' && season === 'winter') {
      return { ...reward, amount: Math.ceil(reward.amount / 2) };
    }
    return { ...reward };
  });
}

function applyRewards(resources: Resources, rewards: SpotReward[]): void {
  for (const reward of rewards) {
    resources[reward.resource] += reward.amount;
  }
}

function applyCosts(resources: Resources, spent: SpotReward[]): void {
  for (const cost of spent) {
    resources[cost.resource] = Math.max(0, resources[cost.resource] - cost.amount);
  }
}

function emptyResult(assignment: Assignment): ResolutionResult {
  return {
    workerId: assignment.workerId,
    spotId: assignment.spotId,
    dice: [1, 1],
    total: 2,
    target: 0,
    outcome: 'failure',
    rewards: [],
    spent: [],
    notes: [],
  };
}

/**
 * 解決順。工房(建設)は市場(売却)より先に解決し、
 * 建設予定の資材が同ラウンドの売却で消えないようにする。
 */
const resolutionOrder = ['farm', 'forest', 'mine', 'workshop', 'market', 'hall', 'ruins', 'shrine'];

function spotOrder(spotId: string): number {
  const index = resolutionOrder.indexOf(spotId);
  return index === -1 ? resolutionOrder.length : index;
}

function cloneWorkers(workers: Worker[]): Worker[] {
  return workers.map((worker) => ({
    ...worker,
    stats: { ...worker.stats },
    traits: [...worker.traits],
  }));
}

export function resourceLabel(resource: Resource): string {
  const labels: Record<Resource, string> = {
    food: '食料',
    wood: '木材',
    ore: '鉱石',
    gold: '金貨',
    prosperity: '繁栄度',
  };
  return labels[resource];
}

export function resourceIcon(resource: Resource): string {
  const icons: Record<Resource, string> = {
    food: '🍞',
    wood: '🪵',
    ore: '⛰️',
    gold: '🪙',
    prosperity: '⭐',
  };
  return icons[resource];
}

import { seasonEvents, seasonLabels, seasons } from '../data/seasons';
import { spots } from '../data/spots';
import { traits } from '../data/traits';
import { initialWorkers } from '../data/workers';
import { Rng, seedFromText } from './rng';
import type {
  Assignment,
  GameState,
  Outcome,
  Resource,
  Resources,
  ResolutionResult,
  Season,
  Spot,
  SpotReward,
  Stat,
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

const recruitPool: Worker[] = [
  {
    id: 'sara',
    name: 'サラ',
    icon: '📚',
    stats: { strength: 1, dexterity: 3, wisdom: 5, charm: 2 },
    traits: ['careful'],
    fatigue: 0,
    injured: 0,
    xp: 0,
  },
  {
    id: 'glen',
    name: 'グレン',
    icon: '🛡️',
    stats: { strength: 5, dexterity: 2, wisdom: 2, charm: 1 },
    traits: ['sturdy'],
    fatigue: 0,
    injured: 0,
    xp: 0,
  },
  {
    id: 'nono',
    name: 'ノノ',
    icon: '🍀',
    stats: { strength: 2, dexterity: 3, wisdom: 3, charm: 3 },
    traits: ['lucky'],
    fatigue: 0,
    injured: 0,
    xp: 0,
  },
];

export function createGame(seedText = String(Date.now())): GameState {
  const seed = seedFromText(seedText);
  return {
    seed,
    round: 1,
    maxRounds: 12,
    targetProsperity: 30,
    phase: 'title',
    workers: cloneWorkers(initialWorkers),
    resources: { food: 7, wood: 2, ore: 1, gold: 2, prosperity: 0 },
    assignments: [],
    log: ['開拓団が辺境の村へ到着した。'],
    preview: buildPreview(1),
    lastResults: [],
    winner: false,
    gameOver: false,
  };
}

export function startGame(state: GameState): GameState {
  return { ...state, phase: 'prepare', preview: buildPreview(state.round) };
}

export function beginPlacement(state: GameState): GameState {
  if (state.gameOver) return state;
  return {
    ...state,
    phase: 'placement',
    assignments: [],
    preview: buildPreview(state.round),
    log: [`ラウンド${state.round}: ${buildPreview(state.round).seasonEvent}`, ...state.log].slice(0, 30),
  };
}

export function assignWorker(state: GameState, workerId: string, spotId: string): GameState {
  const spot = getSpot(spotId);
  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker || !spot || !isSpotUnlocked(spot, state.round) || worker.injured > 0) return state;
  if (state.assignments.some((assignment) => assignment.workerId === workerId)) return state;
  if (state.assignments.filter((assignment) => assignment.spotId === spotId).length >= spot.capacity) return state;
  return {
    ...state,
    assignments: [...state.assignments, { workerId, spotId }],
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
  const orderedAssignments = [...state.assignments].sort((a, b) => spotOrder(a.spotId) - spotOrder(b.spotId));
  const results = orderedAssignments.map((assignment) => resolveOne(assignment, workers, resources, state, rng));
  const log = [
    ...results.map((result) => {
      const worker = workers.find((candidate) => candidate.id === result.workerId);
      const spot = getSpot(result.spotId);
      return `${worker?.name ?? '誰か'}: ${spot?.name ?? '不明'} ${outcomeLabels[result.outcome]} (${result.dice.join('+')} => ${result.total}/${result.target})`;
    }),
    ...state.log,
  ].slice(0, 30);

  return {
    ...state,
    phase: 'resolution',
    workers,
    resources,
    lastResults: results,
    log,
  };
}

export function finishUpkeep(state: GameState): GameState {
  const resources = { ...state.resources };
  let workers = cloneWorkers(state.workers).map((worker) => ({
    ...worker,
    fatigue: Math.max(0, worker.fatigue - (getSeason(state.round) === 'summer' ? 0 : 1)),
    injured: Math.max(0, worker.injured - 1),
  }));

  const foodCost = workers.length + (getSeason(state.round) === 'winter' ? 1 : 0);
  resources.food -= foodCost;
  if (getSeason(state.round) === 'autumn') resources.food += 1;

  const log: string[] = [`維持: 食料 ${foodCost} 消費`];
  if (resources.food < 0) {
    const shortage = Math.abs(resources.food);
    resources.food = 0;
    workers = workers
      .map((worker) => ({ ...worker, fatigue: worker.fatigue + 1 }))
      .filter((worker) => worker.fatigue < 5);
    log.push(`食料不足 ${shortage}: 疲労が増え、限界の仲間は離脱`);
  }

  const noWorkers = workers.length === 0;
  const lastRound = state.round >= state.maxRounds;
  const winner = resources.prosperity >= state.targetProsperity && (lastRound || resources.prosperity >= state.targetProsperity);
  const gameOver = noWorkers || lastRound || winner;

  return {
    ...state,
    phase: gameOver ? 'result' : 'prepare',
    round: gameOver ? state.round : state.round + 1,
    workers,
    resources,
    assignments: [],
    preview: buildPreview(gameOver ? state.round : state.round + 1),
    winner,
    gameOver,
    log: [...log, ...state.log].slice(0, 30),
  };
}

export function getSeason(round: number): Season {
  return seasons[Math.min(seasons.length - 1, Math.floor((round - 1) / 3))];
}

export function buildPreview(round: number) {
  const season = getSeason(round);
  return {
    season,
    seasonLabel: seasonLabels[season],
    seasonEvent: seasonEvents[season],
    unlockedSpotIds: spots.filter((spot) => isSpotUnlocked(spot, round)).map((spot) => spot.id),
  };
}

export function isSpotUnlocked(spot: Spot, round: number): boolean {
  const unlockIndex = seasons.indexOf(spot.unlockSeason);
  const seasonIndex = seasons.indexOf(getSeason(round));
  return seasonIndex >= unlockIndex;
}

export function successProbability(worker: Worker, spot: Spot, assignments: Assignment[] = []): number {
  let wins = 0;
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      const total = first + second + worker.stats[spot.stat] + traitBonus(worker, spot, assignments) - worker.fatigue - (worker.injured > 0 ? 2 : 0);
      if (total >= spot.difficulty) wins += 1;
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

function resolveOne(assignment: Assignment, workers: Worker[], resources: Resources, state: GameState, rng: Rng): ResolutionResult {
  const worker = workers.find((candidate) => candidate.id === assignment.workerId);
  const spot = getSpot(assignment.spotId);
  if (!worker || !spot) {
    return {
      ...emptyResult(assignment),
      notes: ['配置先を解決できませんでした。'],
    };
  }

  const dice: [number, number] = [rng.int(1, 6), rng.int(1, 6)];
  const modifier = worker.stats[spot.stat] + traitBonus(worker, spot, state.assignments) - worker.fatigue - (worker.injured > 0 ? 2 : 0);
  const total = dice[0] + dice[1] + modifier;
  const margin = total - spot.difficulty;
  let outcome = determineOutcome(dice, margin);
  const notes: string[] = [];

  if (outcome === 'criticalFailure' && worker.traits.includes('lucky')) {
    outcome = 'failure';
    notes.push('幸運で大失敗を回避');
  }

  const rewards = applySeasonToRewards(spot, outcome, state.round);
  applyRewards(resources, rewards);
  worker.xp += outcome === 'criticalSuccess' ? 2 : outcome === 'success' ? 1 : 0;
  worker.fatigue += spot.risk.fatigue + (outcome === 'criticalFailure' ? 1 : 0);
  if ((outcome === 'failure' || outcome === 'criticalFailure') && rng.chance(spot.risk.injuryChance)) {
    worker.injured = 2;
    notes.push('負傷');
  }

  if (spot.id === 'hall' && (outcome === 'success' || outcome === 'criticalSuccess')) {
    const recruit = recruitPool.find((candidate) => !workers.some((present) => present.id === candidate.id));
    if (recruit) {
      workers.push({ ...recruit, stats: { ...recruit.stats }, traits: [...recruit.traits] });
      notes.push(`${recruit.name}が加入`);
    }
  }

  return {
    workerId: worker.id,
    spotId: spot.id,
    dice,
    total,
    target: spot.difficulty,
    outcome,
    rewards,
    notes,
  };
}

function traitBonus(worker: Worker, spot: Spot, assignments: Assignment[]): number {
  return worker.traits.reduce((sum, traitId) => sum + traits[traitId].bonus({ worker, spot, assignments }), 0);
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
    if (spot.id === 'farm' && reward.resource === 'food' && season === 'spring') {
      return { ...reward, amount: reward.amount + 1 };
    }
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

function emptyResult(assignment: Assignment): ResolutionResult {
  return {
    workerId: assignment.workerId,
    spotId: assignment.spotId,
    dice: [1, 1],
    total: 2,
    target: 0,
    outcome: 'failure',
    rewards: [],
    notes: [],
  };
}

function spotOrder(spotId: string): number {
  return spots.findIndex((spot) => spot.id === spotId);
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

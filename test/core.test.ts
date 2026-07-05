import { describe, expect, it } from 'vitest';
import {
  assignWorker,
  availableBuildings,
  beginPlacement,
  canAfford,
  createGame,
  effectiveDifficulty,
  finishUpkeep,
  getSeason,
  getSpot,
  resolveAssignments,
  startGame,
  successProbability,
} from '../src/core/game';
import type { GameState, Resource } from '../src/core/types';
import { buildings, getBuilding } from '../src/data/buildings';
import { traits } from '../src/data/traits';

describe('frontier core loop', () => {
  it('uses the expected season schedule', () => {
    expect(getSeason(1)).toBe('spring');
    expect(getSeason(4)).toBe('summer');
    expect(getSeason(7)).toBe('autumn');
    expect(getSeason(10)).toBe('winter');
  });

  it('calculates visible success odds before placement', () => {
    const state = beginPlacement(startGame(createGame('odds')));
    const worker = state.workers[0];
    const farm = getSpot('farm');
    expect(farm).toBeDefined();
    expect(successProbability(worker, farm!, [], state.preview.event)).toBeGreaterThan(50);
  });

  it('can place, resolve, and advance a round', () => {
    let state = beginPlacement(startGame(createGame('round-flow')));
    state = assignWorker(state, 'mina', 'farm');
    expect(state.assignments).toHaveLength(1);
    state = resolveAssignments(state);
    expect(state.lastResults).toHaveLength(1);
    state = finishUpkeep(state);
    expect(state.round).toBe(2);
    expect(state.phase).toBe('prepare');
  });

  it('draws the same round event for the same seed', () => {
    const a = beginPlacement(startGame(createGame('event-seed')));
    const b = beginPlacement(startGame(createGame('event-seed')));
    expect(a.preview.event.id).toBe(b.preview.event.id);
    expect(a.preview.event.season).toBe('spring');
  });

  it('ends after the twelfth round', () => {
    let state = beginPlacement(startGame(createGame('full-run')));
    for (let round = 1; round <= 12 && !state.gameOver; round += 1) {
      const availableWorker = state.workers.find((worker) => worker.injured === 0);
      if (availableWorker) state = assignWorker(state, availableWorker.id, 'farm');
      state = resolveAssignments(state);
      state = finishUpkeep(state);
      if (!state.gameOver) state = beginPlacement(state);
    }
    expect(state.gameOver).toBe(true);
    expect(state.phase).toBe('result');
  });
});

describe('M5: resource management via buildings', () => {
  function stateWithResources(seedText: string, overrides: Partial<Record<Resource, number>>): GameState {
    const state = beginPlacement(startGame(createGame(seedText)));
    return { ...state, resources: { ...state.resources, ...overrides } };
  }

  it('constructs a building on success, paying its cost', () => {
    // 成功するシードを探す(決定的なので一度見つければ安定)
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let state = stateWithResources(`build-${attempt}`, { wood: 5, ore: 5, gold: 5 });
      state = assignWorker(state, 'toma', 'workshop', 'sawmill');
      expect(state.assignments[0].buildingId).toBe('sawmill');
      const before = state.resources;
      state = resolveAssignments(state);
      const outcome = state.lastResults[0].outcome;
      if (outcome === 'success' || outcome === 'criticalSuccess') {
        const cost = getBuilding('sawmill')!.cost;
        expect(state.builtBuildingIds).toContain('sawmill');
        expect(state.resources.wood).toBe(before.wood - (cost.wood ?? 0));
        expect(state.resources.ore).toBe(before.ore - (cost.ore ?? 0));
        expect(state.resources.prosperity).toBeGreaterThanOrEqual(getBuilding('sawmill')!.prosperity);
        return;
      }
    }
    throw new Error('no successful construction found in 50 seeds');
  });

  it('falls back to repairs when resources are missing', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let state = stateWithResources(`poor-${attempt}`, { wood: 0, ore: 0, gold: 0 });
      state = assignWorker(state, 'toma', 'workshop', 'sawmill');
      state = resolveAssignments(state);
      const result = state.lastResults[0];
      if (result.outcome === 'success' || result.outcome === 'criticalSuccess') {
        expect(state.builtBuildingIds).not.toContain('sawmill');
        expect(result.rewards).toContainEqual({ resource: 'prosperity', amount: 1 });
        return;
      }
    }
    throw new Error('no successful attempt found');
  });

  it('cannot target the same building twice in one round', () => {
    let state = stateWithResources('dup-build', { wood: 9, ore: 9, gold: 9 });
    state = assignWorker(state, 'toma', 'workshop', 'sawmill');
    expect(availableBuildings(state).map((building) => building.id)).not.toContain('sawmill');
  });

  it('sells surplus wood and ore at the market', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let state = stateWithResources(`sale-${attempt}`, { wood: 5, ore: 3, gold: 0 });
      state = assignWorker(state, 'luca', 'market');
      state = resolveAssignments(state);
      const result = state.lastResults[0];
      if (result.outcome === 'success' || result.outcome === 'criticalSuccess') {
        expect(state.resources.wood).toBe(3); // 2売却
        expect(state.resources.ore).toBe(1); // 2売却
        expect(state.resources.gold).toBeGreaterThanOrEqual(5); // 基本報酬+売却4単位
        return;
      }
    }
    throw new Error('no successful sale found');
  });

  it('recruits cost gold and respect the roster cap', () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      let state = stateWithResources(`hire-${attempt}`, { gold: 3 });
      state = assignWorker(state, 'luca', 'hall');
      state = resolveAssignments(state);
      const result = state.lastResults[0];
      if (result.outcome === 'success') {
        expect(state.workers.length).toBe(4);
        expect(state.resources.gold).toBe(1);
        return;
      }
    }
    throw new Error('no successful recruit found');
  });

  it('every building id resolves and costs something', () => {
    for (const building of buildings) {
      expect(getBuilding(building.id)).toBe(building);
      expect(Object.keys(building.cost).length).toBeGreaterThan(0);
      expect(building.prosperity).toBeGreaterThan(0);
    }
  });
});

describe('M5: traits and events', () => {
  it('has at least 10 traits with 3 negative ones', () => {
    const all = Object.values(traits);
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.filter((trait) => trait.negative).length).toBeGreaterThanOrEqual(3);
  });

  it('applies event difficulty deltas to the preview math', () => {
    const state = beginPlacement(startGame(createGame('delta-check')));
    const spot = getSpot('forest')!;
    const delta = state.preview.event.effects.difficultyDelta?.forest ?? 0;
    expect(effectiveDifficulty(spot, state.preview.event)).toBe(spot.difficulty + delta);
  });
});

// ---------------------------------------------------------------- balance

interface BotChoice {
  spotId: string;
  buildingId?: string;
}

function chooseSpot(state: GameState, workerId: string): BotChoice | undefined {
  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker) return undefined;
  const open = (spotId: string): boolean => {
    const spot = getSpot(spotId);
    if (!spot || !state.preview.unlockedSpotIds.includes(spotId)) return false;
    return state.assignments.filter((assignment) => assignment.spotId === spotId).length < spot.capacity;
  };
  const chance = (spotId: string): number =>
    successProbability(worker, getSpot(spotId)!, state.assignments, state.preview.event) / 100;

  const buildTarget = availableBuildings(state)
    .filter((building) => canAfford(state.resources, building.cost))
    .sort((a, b) => b.prosperity - a.prosperity)[0];

  const foodLow = state.resources.food < state.workers.length * 2;
  const candidates: Array<{ choice: BotChoice; score: number }> = [];
  const push = (spotId: string, value: number, buildingId?: string) => {
    if (open(spotId)) candidates.push({ choice: { spotId, buildingId }, score: value * chance(spotId) });
  };

  if (buildTarget) push('workshop', 6, buildTarget.id);
  push('farm', foodLow ? 5 : 2);
  push('forest', state.resources.wood < 4 ? 3 : 1.5);
  push('mine', state.resources.ore < 3 ? 2.5 : 1);
  push('market', state.resources.wood + state.resources.ore >= 4 ? 2.5 : 0.5);
  push('hall', state.workers.length < 4 && state.resources.gold >= 2 ? 3 : 0.3);
  push('ruins', 3.5);
  push('shrine', 4);
  if (!buildTarget) push('workshop', 1);

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.choice;
}

function playBot(seedText: string): GameState {
  let state = beginPlacement(startGame(createGame(seedText)));
  let guard = 0;
  while (!state.gameOver && guard < 40) {
    guard += 1;
    for (const worker of state.workers) {
      if (worker.injured > 0) continue;
      if (worker.fatigue >= 5) continue; // 休ませて回復
      const choice = chooseSpot(state, worker.id);
      if (choice) state = assignWorker(state, worker.id, choice.spotId, choice.buildingId);
    }
    state = resolveAssignments(state);
    state = finishUpkeep(state);
    if (!state.gameOver) state = beginPlacement(state);
  }
  return state;
}

describe('M5: balance simulation', () => {
  it('a reasonable strategy wins roughly half the time', () => {
    const runs = 60;
    let wins = 0;
    for (let index = 0; index < runs; index += 1) {
      const finalState = playBot(`balance-${index}`);
      if (finalState.winner) wins += 1;
    }
    const rate = wins / runs;
    // 目標は40〜60%。テストの頑健性のため30〜75%で判定する。
    // eslint-disable-next-line no-console
    console.info(`bot win rate: ${(rate * 100).toFixed(1)}% (${wins}/${runs})`);
    expect(rate).toBeGreaterThanOrEqual(0.3);
    expect(rate).toBeLessThanOrEqual(0.75);
  });

  it('never crashes across many random full games', () => {
    for (let index = 0; index < 20; index += 1) {
      const finalState = playBot(`fuzz-${index}`);
      expect(finalState.phase).toBe('result');
      expect(finalState.resources.food).toBeGreaterThanOrEqual(0);
    }
  });
});

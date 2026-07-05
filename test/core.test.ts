import { describe, expect, it } from 'vitest';
import {
  assignWorker,
  beginPlacement,
  createGame,
  finishUpkeep,
  getSeason,
  getSpot,
  resolveAssignments,
  startGame,
  successProbability,
} from '../src/core/game';

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
    expect(successProbability(worker, farm!)).toBeGreaterThan(50);
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

  it('ends after the twelfth round', () => {
    let state = beginPlacement(startGame(createGame('full-run')));
    for (let round = 1; round <= 12 && !state.gameOver; round += 1) {
      const availableWorker = state.workers.find((worker) => worker.injured === 0);
      if (availableWorker) state = assignWorker(state, availableWorker.id, 'workshop');
      state = resolveAssignments(state);
      state = finishUpkeep(state);
      if (!state.gameOver) state = beginPlacement(state);
    }
    expect(state.gameOver).toBe(true);
    expect(state.phase).toBe('result');
  });
});

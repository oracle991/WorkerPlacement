import { describe, expect, it } from 'vitest';
import {
  assignWorker,
  beginPlacement,
  createGame,
  finishUpkeep,
  getSpot,
  resolveAssignments,
  startGame,
  successProbability,
} from '../src/core/game';
import { Rng } from '../src/core/rng';
import {
  SAVE_VERSION,
  deserializeGame,
  serializeGame,
} from '../src/core/save';
import type { GameState } from '../src/core/types';

/**
 * テスト用の簡易 Bot: 手が空いた各ワーカーを農場へ置く。
 * `interruptRound` が指定されたラウンドの配置フェーズに入った時点で
 * 一度セーブ→ロードを挟み、以降を復元後の状態から継続する。
 */
function autoPlay(initial: GameState, interruptRound?: number): GameState {
  let state = initial;
  let guard = 0;
  let interrupted = false;
  while (!state.gameOver && guard < 40) {
    guard += 1;
    if (!interrupted && state.round === interruptRound) {
      state = deserializeGame(serializeGame(state))!;
      interrupted = true;
    }
    for (const worker of state.workers) {
      if (worker.injured > 0) continue;
      if (state.assignments.some((a) => a.workerId === worker.id)) continue;
      const farm = getSpot('farm')!;
      if (successProbability(worker, farm, state.assignments, state.preview.event) > 0) {
        state = assignWorker(state, worker.id, 'farm');
      }
    }
    state = resolveAssignments(state);
    state = finishUpkeep(state);
    if (!state.gameOver) state = beginPlacement(state);
  }
  return state;
}

describe('M6: localStorage save (resume only)', () => {
  it('round-trips a mid-game state via deepEqual', () => {
    // 数ラウンド進めた途中状態を作る
    let state = beginPlacement(startGame(createGame('save-roundtrip', 'hard')));
    state = assignWorker(state, 'mina', 'farm');
    state = resolveAssignments(state);
    state = finishUpkeep(state);
    state = beginPlacement(state);
    state = assignWorker(state, 'toma', 'forest');

    const restored = deserializeGame(serializeGame(state));
    expect(restored).toEqual(state);
    // 難易度もセーブから復元される
    expect(restored?.difficultyId).toBe('hard');
  });

  it('can be resumed and played to the end after deserialize', () => {
    let state = beginPlacement(startGame(createGame('save-resume')));
    // 中断ポイントまで進める
    state = assignWorker(state, 'mina', 'farm');
    state = resolveAssignments(state);
    state = finishUpkeep(state);
    state = beginPlacement(state);

    const restored = deserializeGame(serializeGame(state));
    expect(restored).not.toBeNull();

    const finished = autoPlay(restored!);
    expect(finished.gameOver).toBe(true);
    expect(finished.phase).toBe('result');
  });

  it('produces the same final state resuming as playing straight through', () => {
    // 同一シード・同一操作なら、途中でセーブ→復元を挟んでも最終状態が中断なしと一致する
    // (RNGは seed+round から決定的に再生成されるため、セーブ復元で乱数列が継続する)。
    const straight = autoPlay(beginPlacement(startGame(createGame('save-parity'))));
    const resumed = autoPlay(beginPlacement(startGame(createGame('save-parity'))), 3);
    expect(resumed).toEqual(straight);
  });

  it('discards saves with a mismatched version', () => {
    const state = beginPlacement(startGame(createGame('save-version')));
    const payload = JSON.parse(serializeGame(state));
    payload.version = SAVE_VERSION + 1;
    expect(deserializeGame(JSON.stringify(payload))).toBeNull();
  });

  it('discards corrupt or empty saves silently', () => {
    expect(deserializeGame(null)).toBeNull();
    expect(deserializeGame('')).toBeNull();
    expect(deserializeGame('not json {')).toBeNull();
    expect(deserializeGame('{"version":1}')).toBeNull();
    expect(deserializeGame('{"version":1,"state":{}}')).toBeNull();
  });
});

describe('M6: RNG state save/restore', () => {
  it('continues the same sequence after getState/setState', () => {
    const source = new Rng(123456);
    // いくらか進めてから内部状態を退避
    for (let i = 0; i < 5; i += 1) source.next();
    const saved = source.getState();

    // 退避後に続く乱数列を記録
    const expected = Array.from({ length: 10 }, () => source.next());

    // 別インスタンスへ状態を復元 → 続きの乱数列が一致すること
    const restored = new Rng(0);
    restored.setState(saved);
    const actual = Array.from({ length: 10 }, () => restored.next());

    expect(actual).toEqual(expected);
  });

  it('two rngs restored from the same state agree on int()', () => {
    const rng = new Rng(777);
    rng.int(1, 6);
    const s = rng.getState();

    const a = new Rng(0);
    a.setState(s);
    const b = new Rng(0);
    b.setState(s);

    expect(a.getState()).toBe(s);
    expect(a.int(1, 6)).toBe(b.int(1, 6));
  });
});

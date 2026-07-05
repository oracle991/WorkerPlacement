import type { GameState } from './types';

/**
 * 中断再開セーブ(スロット1つのみ)。
 *
 * ここは Phaser 非依存の純TS。core はシリアライズ済み JSON 文字列か
 * プレーンオブジェクトだけを扱い、localStorage の読み書きは薄いラッパ
 * (このファイル末尾の `*Save` 関数)へ隔離する。
 *
 * ## RNG の再現性について
 * ゲームの乱数は毎操作ごとに `new Rng(state.seed + state.round * ...)` の形で
 * `state.seed`(mulberry32 のシード)と `state.round` から決定的に生成される。
 * したがって GameState をそのまま保存・復元すれば、以降の乱数列は中断しなかった
 * 場合と完全に一致する。mulberry32 の内部状態(=シード)は GameState.seed として
 * セーブに含まれる。`Rng.getState()/setState()` は状態の取得/復元を保証する
 * 下支えで、ユニットテストで乱数列の継続を検証している。
 */

/** セーブフォーマットのバージョン。互換性を壊す変更のたびに上げる。 */
export const SAVE_VERSION = 1;

/** localStorage のキー名。 */
export const SAVE_KEY = 'frontier-save-v1';

export interface SaveData {
  version: number;
  state: GameState;
}

/** GameState を保存用の JSON 文字列へ変換する。 */
export function serializeGame(state: GameState): string {
  const payload: SaveData = { version: SAVE_VERSION, state };
  return JSON.stringify(payload);
}

/**
 * 保存用 JSON 文字列を GameState へ戻す。
 * パース失敗・バージョン不一致・構造不正のときは黙って null を返す(セーブを破棄)。
 */
export function deserializeGame(json: string | null | undefined): GameState | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isSaveData(parsed)) return null;
  if (parsed.version !== SAVE_VERSION) return null;
  return parsed.state;
}

function isSaveData(value: unknown): value is SaveData {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'number') return false;
  const state = candidate.state as Partial<GameState> | undefined;
  if (typeof state !== 'object' || state === null) return false;
  // 最低限の構造チェック。壊れたセーブを黙って捨てるための保険。
  return (
    typeof state.seed === 'number' &&
    typeof state.round === 'number' &&
    typeof state.phase === 'string' &&
    typeof state.difficultyId === 'string' &&
    Array.isArray(state.workers) &&
    typeof state.resources === 'object' &&
    state.resources !== null &&
    typeof state.preview === 'object' &&
    state.preview !== null
  );
}

// ---------------------------------------------------------------- storage
// localStorage への実アクセスはここだけ。テスト(node 環境)からは呼ばれない。

function storage(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

/** 現在のゲーム状態をスロットへ書き込む。 */
export function writeSave(state: GameState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SAVE_KEY, serializeGame(state));
  } catch {
    // 容量超過などは黙って無視する(セーブは補助機能)。
  }
}

/** スロットからゲーム状態を読み込む。無効・不在なら null。 */
export function readSave(): GameState | null {
  const store = storage();
  if (!store) return null;
  try {
    return deserializeGame(store.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

/** 有効なセーブが存在するか(「続きから」ボタンの表示判定)。 */
export function hasSave(): boolean {
  return readSave() !== null;
}

/** スロットを削除する(ゲーム終了時)。 */
export function clearSave(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // 無視
  }
}

export type Stat = 'strength' | 'dexterity' | 'wisdom' | 'charm';
export type Resource = 'food' | 'wood' | 'ore' | 'gold' | 'prosperity';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Phase = 'title' | 'prepare' | 'placement' | 'resolution' | 'upkeep' | 'result';
export type Outcome = 'criticalSuccess' | 'success' | 'failure' | 'criticalFailure';
export type DifficultyId = 'easy' | 'normal' | 'hard';
export type TraitId =
  | 'mighty'
  | 'crafty'
  | 'sage'
  | 'charming'
  | 'careful'
  | 'lucky'
  | 'social'
  | 'sturdy'
  | 'hardworking'
  | 'merchant'
  | 'timid'
  | 'lazy'
  | 'frail';

export interface Worker {
  id: string;
  name: string;
  icon: string;
  stats: Record<Stat, number>;
  traits: TraitId[];
  fatigue: number;
  injured: number;
  xp: number;
  level: number;
}

export interface SpotReward {
  resource: Resource;
  amount: number;
}

export interface SpotRisk {
  fatigue: number;
  injuryChance: number;
}

export interface Spot {
  id: string;
  name: string;
  icon: string;
  stat: Stat;
  difficulty: number;
  capacity: number;
  unlockSeason: Season;
  rewards: Record<Outcome, SpotReward[]>;
  risk: SpotRisk;
  description: string;
}

export interface BuildingEffects {
  /** スポット成功時の追加報酬: spotId -> 追加報酬 */
  spotBonus?: { spotId: string; resource: Resource; amount: number };
  /** 維持フェーズの食料消費 -N */
  foodUpkeepSaving?: number;
  /** 維持フェーズの疲労回復 +N */
  fatigueRecoveryBonus?: number;
  /** 維持フェーズの負傷回復 +N */
  injuryRecoveryBonus?: number;
  /** 市場売却時の追加金貨 */
  marketGoldBonus?: number;
}

export interface Building {
  id: string;
  name: string;
  icon: string;
  cost: Partial<Record<Resource, number>>;
  prosperity: number;
  effects: BuildingEffects;
  description: string;
}

export interface Assignment {
  workerId: string;
  spotId: string;
  /** 工房での建設対象。未指定なら修繕(小額の繁栄度) */
  buildingId?: string;
}

export interface Resources {
  food: number;
  wood: number;
  ore: number;
  gold: number;
  prosperity: number;
}

export interface RoundEventEffects {
  /** spotId -> 難易度補正 */
  difficultyDelta?: Record<string, number>;
  /** spotId -> 成功時の追加報酬 */
  spotBonus?: { spotId: string; resource: Resource; amount: number };
  /** 準備フェーズで即時獲得する資源 */
  immediate?: SpotReward[];
  /** 維持フェーズの食料消費への補正 */
  upkeepFoodDelta?: number;
}

export interface RoundEvent {
  id: string;
  name: string;
  season: Season;
  description: string;
  effects: RoundEventEffects;
}

export interface RoundPreview {
  season: Season;
  seasonLabel: string;
  seasonNote: string;
  event: RoundEvent;
  unlockedSpotIds: string[];
}

export interface ResolutionResult {
  workerId: string;
  spotId: string;
  dice: [number, number];
  total: number;
  target: number;
  outcome: Outcome;
  rewards: SpotReward[];
  spent: SpotReward[];
  notes: string[];
}

export interface GameState {
  seed: number;
  round: number;
  maxRounds: number;
  targetProsperity: number;
  difficultyId: DifficultyId;
  phase: Phase;
  workers: Worker[];
  resources: Resources;
  assignments: Assignment[];
  builtBuildingIds: string[];
  log: string[];
  preview: RoundPreview;
  lastResults: ResolutionResult[];
  winner: boolean;
  gameOver: boolean;
}

export interface Difficulty {
  id: DifficultyId;
  label: string;
  description: string;
  /** クリアに必要な繁栄度 */
  targetProsperity: number;
  /**
   * 引いたラウンドイベントが「過酷でない」とき、過酷なイベントへ引き直す確率(Hard用)。
   * 0 なら引き直さない(RNG消費なし)。
   */
  harshEventChance: number;
  /**
   * 引いたラウンドイベントが「過酷」なとき、和らげたイベントへ引き直す確率(Easy用)。
   * 0 なら引き直さない(RNG消費なし)。
   */
  kindEventChance: number;
  /** 開始時の資源補正(基準値への加算) */
  startResourceDelta: Partial<Resources>;
}

export interface TraitContext {
  worker: Worker;
  spot: Spot;
  assignments: Assignment[];
  difficulty: number;
}

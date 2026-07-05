export type Stat = 'strength' | 'dexterity' | 'wisdom' | 'charm';
export type Resource = 'food' | 'wood' | 'ore' | 'gold' | 'prosperity';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Phase = 'title' | 'prepare' | 'placement' | 'resolution' | 'upkeep' | 'result';
export type Outcome = 'criticalSuccess' | 'success' | 'failure' | 'criticalFailure';
export type TraitId = 'mighty' | 'careful' | 'lucky' | 'social' | 'sturdy' | 'crafty';

export interface Worker {
  id: string;
  name: string;
  icon: string;
  stats: Record<Stat, number>;
  traits: TraitId[];
  fatigue: number;
  injured: number;
  xp: number;
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

export interface Assignment {
  workerId: string;
  spotId: string;
}

export interface Resources {
  food: number;
  wood: number;
  ore: number;
  gold: number;
  prosperity: number;
}

export interface RoundPreview {
  season: Season;
  seasonLabel: string;
  seasonEvent: string;
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
  notes: string[];
}

export interface GameState {
  seed: number;
  round: number;
  maxRounds: number;
  targetProsperity: number;
  phase: Phase;
  workers: Worker[];
  resources: Resources;
  assignments: Assignment[];
  log: string[];
  preview: RoundPreview;
  lastResults: ResolutionResult[];
  winner: boolean;
  gameOver: boolean;
}

export interface TraitContext {
  worker: Worker;
  spot: Spot;
  assignments: Assignment[];
  margin?: number;
}

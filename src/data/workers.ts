import type { Worker } from '../core/types';

export const initialWorkers: Worker[] = [
  {
    id: 'mina',
    name: 'ミナ',
    icon: '🌾',
    stats: { strength: 4, dexterity: 2, wisdom: 2, charm: 3 },
    traits: ['mighty'],
    fatigue: 0,
    injured: 0,
    xp: 0,
  },
  {
    id: 'toma',
    name: 'トーマ',
    icon: '🛠️',
    stats: { strength: 2, dexterity: 4, wisdom: 3, charm: 2 },
    traits: ['crafty'],
    fatigue: 0,
    injured: 0,
    xp: 0,
  },
  {
    id: 'luca',
    name: 'ルカ',
    icon: '🗣️',
    stats: { strength: 2, dexterity: 2, wisdom: 3, charm: 4 },
    traits: ['social', 'lucky'],
    fatigue: 0,
    injured: 0,
    xp: 0,
  },
];

import type { Season } from '../core/types';

export const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const seasonLabels: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

export const seasonIcons: Record<Season, string> = {
  spring: '🌸',
  summer: '☀️',
  autumn: '🍂',
  winter: '❄️',
};

/** 季節ごとの固定ルール(ラウンドイベントとは別に常時適用) */
export const seasonNotes: Record<Season, string> = {
  spring: '穏やかな季節。特別な補正はない。',
  summer: '維持フェーズの疲労回復がない。',
  autumn: '維持フェーズで食料 +1。',
  winter: '食料消費 +1、農場の産出半減。',
};

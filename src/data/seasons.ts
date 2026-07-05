import type { Season } from '../core/types';

export const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const seasonLabels: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

export const seasonEvents: Record<Season, string> = {
  spring: '芽吹き: 農場の食料 +1',
  summer: '炎天: 維持で疲労回復が少し鈍る',
  autumn: '収穫: 維持時に食料 +1',
  winter: '冬支度: 食料消費 +1、農場の産出半減',
};

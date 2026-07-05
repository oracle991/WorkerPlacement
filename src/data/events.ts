import type { RoundEvent, Season } from '../core/types';

/**
 * 準備フェーズで季節ごとのテーブルから抽選されるラウンドイベント。
 * 判定・報酬への影響は配置前にすべてプレビューに表示される。
 */
export const eventTable: Record<Season, RoundEvent[]> = {
  spring: [
    {
      id: 'sprout',
      name: '芽吹き',
      season: 'spring',
      description: '農場の成功時、食料 +1。',
      effects: { spotBonus: { spotId: 'farm', resource: 'food', amount: 1 } },
    },
    {
      id: 'spring-rain',
      name: '春の雨',
      season: 'spring',
      description: '地面が柔らかい。森林の難易度 -1。',
      effects: { difficultyDelta: { forest: -1 } },
    },
    {
      id: 'peddler',
      name: '行商人',
      season: 'spring',
      description: '市場の成功時、金貨 +1。',
      effects: { spotBonus: { spotId: 'market', resource: 'gold', amount: 1 } },
    },
    {
      id: 'calm-spring',
      name: '穏やかな日',
      season: 'spring',
      description: '特に変わったことはない。',
      effects: {},
    },
  ],
  summer: [
    {
      id: 'heatwave',
      name: '炎天',
      season: 'summer',
      description: '暑さが堪える。農場と森林の難易度 +1。',
      effects: { difficultyDelta: { farm: 1, forest: 1 } },
    },
    {
      id: 'good-catch',
      name: '豊漁',
      season: 'summer',
      description: '川で魚がよく獲れた。食料 +2。',
      effects: { immediate: [{ resource: 'food', amount: 2 }] },
    },
    {
      id: 'festival',
      name: '夏祭り',
      season: 'summer',
      description: '村が賑わう。集会所と市場の難易度 -1。',
      effects: { difficultyDelta: { hall: -1, market: -1 } },
    },
    {
      id: 'bandit-rumor',
      name: '山賊の噂',
      season: 'summer',
      description: '遺跡周辺が物騒だ。遺跡の難易度 +1。',
      effects: { difficultyDelta: { ruins: 1 } },
    },
  ],
  autumn: [
    {
      id: 'harvest-festival',
      name: '収穫祭',
      season: 'autumn',
      description: '実りに感謝。食料 +2。',
      effects: { immediate: [{ resource: 'food', amount: 2 }] },
    },
    {
      id: 'long-rain',
      name: '長雨',
      season: 'autumn',
      description: 'ぬかるみがひどい。農場と森林の難易度 +1。',
      effects: { difficultyDelta: { farm: 1, forest: 1 } },
    },
    {
      id: 'caravan',
      name: '商隊の来訪',
      season: 'autumn',
      description: '珍しい客だ。市場の成功時、金貨 +2。',
      effects: { spotBonus: { spotId: 'market', resource: 'gold', amount: 2 } },
    },
    {
      id: 'clear-sky',
      name: '秋晴れ',
      season: 'autumn',
      description: '気持ちのいい日。祠の難易度 -1。',
      effects: { difficultyDelta: { shrine: -1 } },
    },
  ],
  winter: [
    {
      id: 'blizzard',
      name: '吹雪',
      season: 'winter',
      description: '外仕事が厳しい。森林と鉱山の難易度 +1。',
      effects: { difficultyDelta: { forest: 1, mine: 1 } },
    },
    {
      id: 'harsh-cold',
      name: '厳冬',
      season: 'winter',
      description: '薪が要る。維持フェーズの食料消費 +1。',
      effects: { upkeepFoodDelta: 1 },
    },
    {
      id: 'mild-winter',
      name: '暖冬',
      season: 'winter',
      description: '過ごしやすい冬。維持フェーズの食料消費 -1。',
      effects: { upkeepFoodDelta: -1 },
    },
    {
      id: 'silent-snow',
      name: '静かな雪',
      season: 'winter',
      description: '村は静かだ。祠の難易度 -1。',
      effects: { difficultyDelta: { shrine: -1 } },
    },
  ],
};

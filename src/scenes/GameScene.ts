import Phaser from 'phaser';
import {
  assignWorker,
  availableBuildings,
  availableSpots,
  beginPlacement,
  canAfford,
  costLabel,
  createGame,
  effectiveDifficulty,
  finishUpkeep,
  getSpot,
  outcomeLabel,
  resourceIcon,
  resolveAssignments,
  startGame,
  statLabel,
  successProbability,
  unassignWorker,
} from '../core/game';
import { clearSave, hasSave, readSave, writeSave } from '../core/save';
import { audio } from '../audio/sfx';
import type { DifficultyId, GameState, ResolutionResult, Spot, Worker } from '../core/types';
import { getBuilding } from '../data/buildings';
import { DEFAULT_DIFFICULTY, difficulties, difficultyOrder, getDifficulty } from '../data/difficulties';
import { traits, traitNames } from '../data/traits';

const FONT = '"Noto Sans JP", sans-serif';

/** 季節ごとの盤面(地面・広場)配色。温かみのあるボード盤面を演出する。 */
const GROUND_PALETTE: Record<string, { g0: number; g1: number; plaza: number; frame: number }> = {
  spring: { g0: 0x33502f, g1: 0x274023, plaza: 0x4a6a4e, frame: 0x6b5836 },
  summer: { g0: 0x3a5a30, g1: 0x2c4726, plaza: 0x5a7a48, frame: 0x7a6432 },
  autumn: { g0: 0x53422a, g1: 0x3e3120, plaza: 0x6a5636, frame: 0x7c5e30 },
  winter: { g0: 0x364550, g1: 0x28333c, plaza: 0x4c5e6a, frame: 0x5f6f7c },
};

/** 季節のアクセント色(スポットタイル上端の帯・小物に使う)。 */
const SEASON_ACCENT: Record<string, number> = {
  spring: 0x7fb069,
  summer: 0xe0b24e,
  autumn: 0xd0763c,
  winter: 0x8fb4d0,
};

/** ダイスの目のピップ配置(グリッド単位 -1/0/1)。 */
const PIP_LAYOUT: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

/** 結果段階ごとのダイス面色・エフェクト色。 */
const OUTCOME_STYLE: Record<string, { face: number; hex: string; num: number }> = {
  criticalSuccess: { face: 0xffe6a0, hex: '#ffd97a', num: 0xffd97a },
  success: { face: 0xf6ecd6, hex: '#9fe3a0', num: 0x9fe3a0 },
  failure: { face: 0xcfcabf, hex: '#b9b9b9', num: 0xb9b9b9 },
  criticalFailure: { face: 0xe8b0a4, hex: '#ff7a7a', num: 0xff7a7a },
};

// HUDパネル(右側 x≈940〜)と重ならない範囲に収める
const SPOT_POSITIONS: Record<string, [number, number]> = {
  farm: [290, 210],
  forest: [470, 195],
  mine: [650, 195],
  market: [830, 210],
  workshop: [290, 390],
  ruins: [470, 385],
  shrine: [650, 385],
  hall: [830, 390],
};

interface SpotView {
  spot: Spot;
  container: Phaser.GameObjects.Container;
}

export class GameScene extends Phaser.Scene {
  private state: GameState = createGame();
  private hud!: HTMLElement;
  private selectedWorkerId: string | undefined;
  private selectedDifficultyId: DifficultyId = DEFAULT_DIFFICULTY;
  private pendingWorkshop = false;
  private hoverInfo = '';
  private spotViews: SpotView[] = [];
  private workerViews: Phaser.GameObjects.Container[] = [];
  private effectLayer!: Phaser.GameObjects.Container;
  /** 季節で色替えする地面グラフィック。season 変化時のみ再描画する。 */
  private boardGround!: Phaser.GameObjects.Graphics;
  private paintedSeason = '';
  private skipResolution = false;
  private resolving = false;
  /** HUD再構築の影響を受けない常設ミュートボタン(#appへ直接append) */
  private muteBtn?: HTMLButtonElement;
  /** result フェーズで勝敗ジングルを1度だけ鳴らすためのフラグ */
  private resultAnnounced = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.hud = document.querySelector('#hud') as HTMLElement;
    this.input.keyboard?.on('keydown-SPACE', () => {
      this.skipResolution = true;
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      this.selectedWorkerId = undefined;
      this.pendingWorkshop = false;
      this.render();
    });
    // タイトル画面(難易度選択)から開始する。state.phase は 'title'。
    this.createMuteButton();
    this.drawBoard();
    this.render();
  }

  /**
   * ミュートトグルを #app 直下の常設DOMとして作る。
   * HUDの innerHTML 再構築(renderHud/updatePanelOnly)とは別の要素にすることで、
   * クリック途中にボタンDOMが消える不発バグを避ける。
   */
  private createMuteButton(): void {
    const app = document.querySelector('#app');
    if (!app) return;
    const existing = app.querySelector('#mute-toggle');
    if (existing) existing.remove();
    const btn = document.createElement('button');
    btn.id = 'mute-toggle';
    btn.type = 'button';
    btn.title = 'サウンドのオン/オフ';
    btn.addEventListener('click', () => {
      const muted = audio.toggleMute();
      if (!muted) audio.playSfx('click');
      this.updateMuteButton();
    });
    app.appendChild(btn);
    this.muteBtn = btn;
    this.updateMuteButton();
  }

  private updateMuteButton(): void {
    if (!this.muteBtn) return;
    const muted = audio.isMuted();
    this.muteBtn.textContent = muted ? '🔇' : '🔊';
    this.muteBtn.classList.toggle('muted', muted);
  }

  /**
   * フェーズに応じて BGM と勝敗ジングルを制御する。render() から毎回呼ぶ。
   * - 通常フェーズ: 季節に応じた BGM をループ(idempotent)。
   * - result フェーズ: BGM を止めて勝敗ジングルを1度だけ鳴らす。
   */
  private syncAudio(): void {
    if (this.state.phase === 'result') {
      if (!this.resultAnnounced) {
        this.resultAnnounced = true;
        audio.stopBgm();
        audio.playSfx(this.state.winner ? 'victory' : 'defeat');
      }
      return;
    }
    this.resultAnnounced = false;
    audio.setBgmSeason(this.state.preview.season);
    audio.startBgm(this.state.preview.season);
  }

  private startRun(): void {
    this.state = beginPlacement(startGame(createGame(String(Date.now()), this.selectedDifficultyId)));
    this.selectedWorkerId = undefined;
    this.pendingWorkshop = false;
    this.effectLayer.removeAll(true);
    this.persist();
    this.render();
  }

  /** セーブから中断していたゲームを復元する(「続きから」)。 */
  private continueRun(): void {
    const saved = readSave();
    if (!saved) {
      this.render();
      return;
    }
    this.state = saved;
    this.selectedDifficultyId = saved.difficultyId;
    this.selectedWorkerId = undefined;
    this.pendingWorkshop = false;
    this.effectLayer.removeAll(true);
    this.render();
  }

  /**
   * 現在のゲーム状態を1つのスロットへ自動保存する。
   * ゲーム終了(勝利/敗北)時はセーブを削除、タイトル画面では保存しない。
   */
  private persist(): void {
    if (this.state.gameOver) {
      clearSave();
    } else if (this.state.phase !== 'title') {
      writeSave(this.state);
    }
  }

  private returnToTitle(): void {
    this.state = createGame(String(Date.now()), this.selectedDifficultyId);
    this.selectedWorkerId = undefined;
    this.pendingWorkshop = false;
    this.effectLayer.removeAll(true);
    this.render();
  }

  private drawBoard(): void {
    this.ensureTextures();

    // 奥行きのある背景グラデーション
    const bg = this.add.graphics().setDepth(-30);
    bg.fillGradientStyle(0x223528, 0x1a2b21, 0x0d150f, 0x0f1a14, 1);
    bg.fillRect(0, 0, 1280, 720);

    // 全面に薄いノイズを重ねて質感を出す(タイル)
    this.add
      .tileSprite(0, 0, 1280, 720, 'wp-noise')
      .setOrigin(0)
      .setAlpha(0.5)
      .setDepth(-28)
      .setBlendMode(Phaser.BlendModes.OVERLAY);

    // 季節で塗り替える地面(render で paintGround)
    this.boardGround = this.add.graphics().setDepth(-20);

    // 盤面のふちを飾る小物(ボードゲームらしさ)
    const decor = this.add.container(0, 0).setDepth(-18);
    const props: Array<[string, number, number, string, number]> = [
      ['🌲', 138, 150, '30px', 0.9], ['🌲', 118, 250, '26px', 0.85], ['🪨', 150, 430, '22px', 0.8],
      ['🌲', 1000, 150, '30px', 0.9], ['🌾', 1010, 300, '24px', 0.8], ['🌲', 985, 430, '26px', 0.85],
      ['🍄', 200, 470, '18px', 0.75], ['🌿', 900, 470, '20px', 0.75],
    ];
    for (const [emoji, px, py, size, alpha] of props) {
      decor.add(this.add.text(px, py, emoji, { fontSize: size }).setOrigin(0.5).setAlpha(alpha));
    }

    // 中央のかがり火(広場)
    this.add.text(560, 296, '🏕️', { fontSize: '42px' }).setOrigin(0.5).setDepth(-16);

    // 画面端を締めるビネット(スポット/カードより奥)
    this.add.image(0, 0, 'wp-vignette').setOrigin(0).setDepth(-10);

    this.effectLayer = this.add.container(0, 0).setDepth(50);
  }

  /**
   * 動的テクスチャ(ノイズ・ビネット)を1度だけ生成する。
   * 外部アセットは使わず Canvas で描く。Math.random はゲームRNGとは無関係。
   */
  private ensureTextures(): void {
    if (!this.textures.exists('wp-noise')) {
      const size = 128;
      const tex = this.textures.createCanvas('wp-noise', size, size);
      const ctx = tex?.getContext();
      if (ctx) {
        const img = ctx.createImageData(size, size);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = 90 + Math.floor(Math.random() * 130);
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 26;
        }
        ctx.putImageData(img, 0, 0);
        tex?.refresh();
      }
    }
    if (!this.textures.exists('wp-vignette')) {
      const w = 1280;
      const h = 720;
      const tex = this.textures.createCanvas('wp-vignette', w, h);
      const ctx = tex?.getContext();
      if (ctx) {
        const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, h * 0.82);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.7, 'rgba(0,0,0,0.12)');
        grad.addColorStop(1, 'rgba(6,10,6,0.62)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        tex?.refresh();
      }
    }
  }

  /** 季節に応じて地面と広場を塗り直す(season 変化時のみ)。 */
  private paintGround(season: string): void {
    if (this.paintedSeason === season) return;
    this.paintedSeason = season;
    const pal = GROUND_PALETTE[season] ?? GROUND_PALETTE.spring;
    const g = this.boardGround;
    g.clear();
    // 盤の落ち影
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(170, 138, 780, 344, 40);
    // 木枠
    g.fillStyle(pal.frame, 1);
    g.fillRoundedRect(164, 124, 792, 352, 40);
    // 地面(内側グラデーション)
    g.fillGradientStyle(pal.g0, pal.g0, pal.g1, pal.g1, 1);
    g.fillRoundedRect(178, 138, 764, 324, 32);
    // 内側の縁ハイライト
    g.lineStyle(2, 0xffffff, 0.06);
    g.strokeRoundedRect(178, 138, 764, 324, 32);
    // 中央広場
    g.fillStyle(pal.plaza, 0.55);
    g.fillCircle(560, 296, 66);
    g.lineStyle(3, pal.frame, 0.5);
    g.strokeCircle(560, 296, 66);
  }

  private render(): void {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__state = this.state;
    }
    this.paintGround(this.state.preview.season);
    this.renderSpots();
    this.renderWorkers();
    this.renderHud();
    this.syncAudio();
  }

  // ---------------------------------------------------------------- spots

  private renderSpots(): void {
    for (const view of this.spotViews) view.container.destroy();
    this.spotViews = [];
    const selected = this.selectedWorker();

    const accent = SEASON_ACCENT[this.state.preview.season] ?? SEASON_ACCENT.spring;
    const highlight = Boolean(selected) && this.state.phase === 'placement';

    for (const spot of availableSpots(this.state.round)) {
      const [x, y] = SPOT_POSITIONS[spot.id] ?? [640, 300];
      const assignedHere = this.state.assignments.filter((assignment) => assignment.spotId === spot.id);
      const full = assignedHere.length >= spot.capacity;
      const difficulty = effectiveDifficulty(spot, this.state.preview.event);
      const modified = difficulty !== spot.difficulty;

      const container = this.add.container(x, y);
      const w = 176;
      const h = 116;
      const canPick = highlight && !full;

      // タイル(影・木地・季節帯・枠)を Graphics で描く
      const gfx = this.add.graphics();
      gfx.fillStyle(0x000000, 0.4);
      gfx.fillRoundedRect(-w / 2 + 3, -h / 2 + 6, w, h, 14);
      gfx.fillStyle(full ? 0x55492c : 0x40361f, 1);
      gfx.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      // 上部の季節アクセント帯
      gfx.fillStyle(accent, full ? 0.55 : 0.85);
      gfx.fillRoundedRect(-w / 2, -h / 2, w, 9, { tl: 14, tr: 14, bl: 0, br: 0 });
      // 上面ハイライト
      gfx.fillStyle(0xffffff, 0.06);
      gfx.fillRoundedRect(-w / 2 + 4, -h / 2 + 11, w - 8, 26, 8);
      // 枠線
      gfx.lineStyle(2, canPick ? 0xffd97a : 0x76633c, 1);
      gfx.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
      if (canPick) {
        gfx.lineStyle(2, 0xffd97a, 0.35);
        gfx.strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 16);
      }
      container.add(gfx);

      const icon = this.add.text(-60, -28, spot.icon, { fontSize: '34px' }).setOrigin(0.5);
      const name = this.add.text(-30, -42, spot.name, {
        fontFamily: FONT, fontSize: '18px', color: '#f5ead0', fontStyle: '700',
      });
      const info = this.add.text(-30, -16, `${statLabel(spot.stat)} / 難${difficulty}`, {
        fontFamily: FONT, fontSize: '13px', color: modified ? (difficulty > spot.difficulty ? '#ff9d7a' : '#9fe3a0') : '#cbbf9d',
      });
      container.add([icon, name, info]);

      // クリック判定用の透明レイヤ(Graphics の上に重ねる)
      const card = this.add.rectangle(0, 0, w, h, 0x000000, 0.001);
      container.add(card);

      // 定員スロット
      for (let slot = 0; slot < spot.capacity; slot += 1) {
        const sx = -58 + slot * 34;
        const occupied = assignedHere[slot];
        const circle = this.add.circle(sx, 26, 15, occupied ? 0xe7c56c : 0x2a2417, 1);
        circle.setStrokeStyle(2, 0x8a7648);
        container.add(circle);
        if (occupied) {
          const workerIcon = this.workerById(occupied.workerId)?.icon ?? '❔';
          container.add(this.add.text(sx, 26, workerIcon, { fontSize: '17px' }).setOrigin(0.5));
        }
      }

      // 選択中ワーカーの成功率をカード上に直接表示
      if (selected && !full && this.state.phase === 'placement') {
        const chance = successProbability(selected, spot, this.state.assignments, this.state.preview.event);
        const color = chance >= 70 ? '#9fe3a0' : chance >= 45 ? '#ffd97a' : '#ff9d7a';
        container.add(
          this.add.text(52, -38, `${chance}%`, {
            fontFamily: FONT, fontSize: '19px', color, fontStyle: '900',
            stroke: '#141009', strokeThickness: 4,
          }).setOrigin(0.5),
        );
      }

      // 建設対象の表示(工房)
      const buildTarget = assignedHere.find((assignment) => assignment.buildingId);
      if (buildTarget?.buildingId) {
        const building = getBuilding(buildTarget.buildingId);
        if (building) {
          container.add(this.add.text(40, 26, `→${building.icon}${building.name}`, {
            fontFamily: FONT, fontSize: '12px', color: '#ffd97a',
          }).setOrigin(0.5));
        }
      }

      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.onSpotClicked(spot));
      card.on('pointerover', () => {
        this.hoverInfo = this.spotTip(spot, difficulty);
        this.updatePanelOnly();
      });
      card.on('pointerout', () => {
        this.hoverInfo = '';
        this.updatePanelOnly();
      });
      this.spotViews.push({ spot, container });
    }
  }

  // -------------------------------------------------------------- workers

  private renderWorkers(): void {
    for (const view of this.workerViews) view.destroy();
    this.workerViews = [];

    const count = this.state.workers.length;
    const spacing = Math.min(200, 960 / Math.max(1, count));
    const startX = 640 - ((count - 1) * spacing) / 2;

    this.state.workers.forEach((worker, index) => {
      const x = startX + index * spacing;
      const y = 622;
      const assigned = this.state.assignments.some((assignment) => assignment.workerId === worker.id);
      const selected = this.selectedWorkerId === worker.id;
      const injured = worker.injured > 0;
      const weary = worker.fatigue >= 4;
      const container = this.add.container(x, y);
      const w = 184;
      const h = 118;

      const bodyColor = selected ? 0x6b5a2c : injured ? 0x3a2622 : assigned ? 0x2c3226 : 0x35422f;
      const borderColor = selected ? 0xffd97a : injured ? 0xb04f42 : weary ? 0xd8b25a : 0x5f7050;

      // カード(影・本体・革の質感・枠)を Graphics で描く
      const gfx = this.add.graphics();
      gfx.fillStyle(0x000000, 0.4);
      gfx.fillRoundedRect(-w / 2 + 2, -h / 2 + 5, w, h, 14);
      gfx.fillStyle(bodyColor, assigned && !selected ? 0.82 : 1);
      gfx.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      // アイコン側の色帯(状態で色替え)
      gfx.fillStyle(injured ? 0xb04f42 : weary ? 0xd8b25a : 0x6f8a5c, 0.9);
      gfx.fillRoundedRect(-w / 2, -h / 2, 34, h, { tl: 14, tr: 0, bl: 14, br: 0 });
      // 上面ハイライト
      gfx.fillStyle(0xffffff, 0.05);
      gfx.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, 22, 8);
      // 枠線
      gfx.lineStyle(2.5, borderColor, 1);
      gfx.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
      if (selected) {
        gfx.lineStyle(2, 0xffd97a, 0.4);
        gfx.strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 16);
      }
      container.add(gfx);

      const card = this.add.rectangle(0, 0, w, h, 0x000000, 0.001);
      container.add(card);
      const icon = this.add.text(-64, -32, worker.icon, { fontSize: '30px' }).setOrigin(0.5);
      if (assigned && !selected) icon.setAlpha(0.85);
      const name = this.add.text(-42, -44, `${worker.name}${worker.level > 0 ? ` Lv${worker.level + 1}` : ''}`, {
        fontFamily: FONT, fontSize: '16px', color: '#f5ead0', fontStyle: '700',
      });
      const stats = this.add.text(-78, -12, `筋${worker.stats.strength} 器${worker.stats.dexterity} 知${worker.stats.wisdom} 魅${worker.stats.charm}`, {
        fontFamily: FONT, fontSize: '13px', color: '#cbbf9d',
      });
      const traitText = this.add.text(-78, 10, traitNames(worker), {
        fontFamily: FONT, fontSize: '12px', color: '#a8c8e8',
      });
      const statusParts: string[] = [];
      if (worker.fatigue > 0) statusParts.push(`😪疲労${worker.fatigue}(判定-${Math.floor(worker.fatigue / 2)})`);
      if (worker.injured > 0) statusParts.push(`🩹負傷 あと${worker.injured}R`);
      if (assigned) statusParts.push('📍配置済');
      const status = this.add.text(-78, 32, statusParts.join(' ') || '待機中', {
        fontFamily: FONT, fontSize: '12px',
        color: worker.injured > 0 ? '#ff9d7a' : worker.fatigue >= 4 ? '#ffd97a' : '#8fa387',
      });
      const xpTrack = this.add.rectangle(-18, 50, 120, 5, 0x1c2418, 0.9).setOrigin(0.5);
      xpTrack.setStrokeStyle(1, 0x000000, 0.3);
      const xpBar = this.add.rectangle(-78, 50, (worker.xp / 5) * 120, 5, 0x8fd0ff, 0.95).setOrigin(0, 0.5);
      container.add([name, stats, traitText, status, xpTrack, xpBar]);
      card.setDepth(1);

      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.onWorkerClicked(worker));
      card.on('pointerover', () => {
        this.hoverInfo = this.workerTip(worker);
        this.updatePanelOnly();
      });
      card.on('pointerout', () => {
        this.hoverInfo = '';
        this.updatePanelOnly();
      });
      this.workerViews.push(container);
    });
  }

  // ------------------------------------------------------------ interaction

  private onWorkerClicked(worker: Worker): void {
    if (this.state.phase !== 'placement' || this.resolving) return;
    this.pendingWorkshop = false;
    if (worker.injured > 0) return;
    if (this.state.assignments.some((assignment) => assignment.workerId === worker.id)) {
      this.state = unassignWorker(this.state, worker.id);
      this.selectedWorkerId = undefined;
      audio.playSfx('unplace');
    } else {
      this.selectedWorkerId = this.selectedWorkerId === worker.id ? undefined : worker.id;
      audio.playSfx('click');
    }
    this.render();
  }

  private onSpotClicked(spot: Spot): void {
    if (this.state.phase !== 'placement' || this.resolving || !this.selectedWorkerId) return;
    if (spot.id === 'workshop') {
      this.pendingWorkshop = true;
      audio.playSfx('click');
      this.renderHud();
      return;
    }
    this.state = assignWorker(this.state, this.selectedWorkerId, spot.id);
    this.selectedWorkerId = undefined;
    audio.playSfx('place');
    this.render();
  }

  private chooseBuilding(buildingId?: string): void {
    if (!this.selectedWorkerId) return;
    this.state = assignWorker(this.state, this.selectedWorkerId, 'workshop', buildingId);
    this.selectedWorkerId = undefined;
    this.pendingWorkshop = false;
    audio.playSfx('place');
    this.render();
  }

  // ------------------------------------------------------------------ hud

  /**
   * ホバー時はパネルの中身だけを差し替える。
   * HUD全体をinnerHTMLで作り直すと、クリック途中のボタンDOMが
   * mousedownとmouseupの間に消えてクリックが不発になるため。
   */
  private updatePanelOnly(): void {
    // タイトル画面ではパネル差し替え禁止。Phaser は window イベントで
    // 盤面のホバーも拾うため、タイトルパネルの下にあるワーカーカードへの
    // pointerover がタイトルパネルを配置フェーズ表示に書き換えてしまい、
    // #start ボタンが mousedown〜mouseup の間に消えてクリック不発になる。
    if (this.state.phase === 'title') return;
    if (this.pendingWorkshop) return; // 施設選択中はホバーで邪魔しない
    const panel = this.hud.querySelector('.panel');
    if (panel) panel.innerHTML = this.renderPanel();
  }

  private renderHud(): void {
    if (this.state.phase === 'title') {
      this.renderTitle();
      return;
    }
    const r = this.state.resources;
    const canResolve = this.state.phase === 'placement' && this.state.assignments.length > 0 && !this.resolving;
    const builtIcons = this.state.builtBuildingIds
      .map((id) => getBuilding(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => `<span title="${b.name}: ${b.description}">${b.icon}</span>`)
      .join('');

    this.hud.innerHTML = `
      <header class="topbar">
        <div class="pill round">R${this.state.round}<span>/${this.state.maxRounds}</span> ${this.state.preview.seasonLabel}</div>
        <div class="resources">
          <span>🍞 ${r.food}</span>
          <span>🪵 ${r.wood}</span>
          <span>⛰️ ${r.ore}</span>
          <span>🪙 ${r.gold}</span>
          <span class="prosperity">⭐ ${r.prosperity}<small>/${this.state.targetProsperity}</small></span>
        </div>
      </header>
      <div class="eventbar">
        <strong>${this.state.preview.event.name}</strong> ${this.state.preview.event.description}
        <em>${this.state.preview.seasonNote}</em>
      </div>
      ${builtIcons ? `<div class="built">村の施設: ${builtIcons}</div>` : ''}
      <aside class="panel ${this.state.phase === 'result' ? 'result' : ''}">${this.renderPanel()}</aside>
      <footer class="actions">
        ${this.state.phase === 'placement' ? `<button id="resolve" class="primary" ${canResolve ? '' : 'disabled'}>⚔️ 解決する</button>` : ''}
        ${this.state.phase === 'resolution' && !this.resolving ? '<button id="upkeep" class="primary">🌙 ラウンドを終える</button>' : ''}
        <button id="restart">🔄 新しい村</button>
      </footer>
    `;
    this.bindHudButtons();
  }

  private renderTitle(): void {
    const options = difficultyOrder
      .map((id) => {
        const difficulty = difficulties[id];
        const selected = id === this.selectedDifficultyId;
        return `
          <button class="diff-option ${selected ? 'selected' : ''}" data-difficulty="${id}">
            <span class="d-name">${difficulty.label} <small>⭐目標 ${difficulty.targetProsperity}</small></span>
            <span class="d-desc">${difficulty.description}</span>
          </button>
        `;
      })
      .join('');
    const chosen = getDifficulty(this.selectedDifficultyId);
    const canContinue = hasSave();
    this.hud.innerHTML = `
      <aside class="panel title">
        <h1>辺境開拓団<small>(仮)</small></h1>
        <p class="lead">個性を持つワーカーを派遣し、12ラウンドで村の繁栄度を目標まで育てよう。</p>
        ${canContinue ? '<button id="continue" class="primary continue">▶️ 続きから</button>' : ''}
        <h2>難易度を選ぶ</h2>
        <div class="diff-list">${options}</div>
        <p class="diff-summary">選択中: <b>${chosen.label}</b> / クリア目標 ⭐${chosen.targetProsperity}</p>
        <button id="start" class="primary start">🚩 新しく始める</button>
      </aside>
    `;
    this.hud.querySelectorAll<HTMLButtonElement>('.diff-option').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.difficulty as DifficultyId | undefined;
        if (id) {
          this.selectedDifficultyId = id;
          audio.playSfx('click');
          this.renderTitle();
        }
      });
    });
    this.hud.querySelector('#start')?.addEventListener('click', () => {
      audio.playSfx('click');
      this.startRun();
    });
    this.hud.querySelector('#continue')?.addEventListener('click', () => {
      audio.playSfx('click');
      this.continueRun();
    });
  }

  private renderPanel(): string {
    if (this.state.phase === 'result') return this.renderResultPanel();
    if (this.pendingWorkshop && this.selectedWorkerId) return this.renderBuildingChooser();
    if (this.hoverInfo) return this.hoverInfo;

    const selected = this.selectedWorker();
    if (selected) {
      return `
        <h2>${selected.icon} ${selected.name}</h2>
        <p class="traits">${this.traitDetails(selected)}</p>
        <p>配置したいスポットをクリック。各スポットに成功率が表示されています。</p>
      `;
    }
    if (this.state.phase === 'resolution') {
      return `
        <h2>解決結果</h2>
        <div class="results">${this.state.lastResults.map((result) => this.formatResult(result)).join('')}</div>
      `;
    }
    return `
      <h2>配置フェーズ</h2>
      <p>ワーカーを選んでスポットへ。全員置かなくてもよい(休ませると疲労回復 +1)。</p>
      <ol class="log">${this.state.log.slice(0, 6).map((line) => `<li>${line}</li>`).join('')}</ol>
    `;
  }

  private renderBuildingChooser(): string {
    const options = availableBuildings(this.state)
      .map((building) => {
        const affordable = canAfford(this.state.resources, building.cost);
        return `
          <button class="build-option ${affordable ? '' : 'poor'}" data-building="${building.id}">
            <span class="b-name">${building.icon} ${building.name} <small>⭐+${building.prosperity}</small></span>
            <span class="b-cost">${costLabel(building.cost)}${affordable ? '' : '(不足)'}</span>
            <span class="b-desc">${building.description}</span>
          </button>
        `;
      })
      .join('');
    return `
      <h2>🏗️ 何を建てる?</h2>
      <p>成功時に資源を消費して建設。資源不足だと修繕(⭐+1)に切り替わる。</p>
      <div class="build-list">
        ${options || '<p>建てられる施設は残っていない。</p>'}
        <button class="build-option repair" data-building="">🔧 修繕のみ(成功⭐+1 / 大成功⭐+2)</button>
      </div>
    `;
  }

  private renderResultPanel(): string {
    const p = this.state.resources.prosperity;
    const rank = this.state.winner
      ? p >= this.state.targetProsperity + 8 ? 'S' : this.state.round <= 10 ? 'A' : 'B'
      : p >= this.state.targetProsperity * 0.8 ? 'C' : 'D';
    return `
      <h2>${this.state.winner ? '🎉 開拓成功!' : '💀 開拓失敗…'}</h2>
      <p class="rank">ランク ${rank}</p>
      <p>繁栄度 ${p} / ${this.state.targetProsperity}(${this.state.round}ラウンド)</p>
      <p>建てた施設: ${this.state.builtBuildingIds.map((id) => getBuilding(id)?.icon ?? '').join('') || 'なし'}</p>
      <p>生き残ったワーカー: ${this.state.workers.map((worker) => worker.icon).join('') || 'なし'}</p>
      <p>${this.state.winner ? '村は辺境で生き残る足場を得た。' : this.state.workers.length === 0 ? '働き手を失い、村は静かに朽ちた。' : '支えが足りず、村は冬を越えられなかった。'}</p>
    `;
  }

  private bindHudButtons(): void {
    this.hud.querySelector('#resolve')?.addEventListener('click', () => {
      audio.playSfx('click');
      void this.playResolution();
    });
    this.hud.querySelector('#upkeep')?.addEventListener('click', () => {
      audio.playSfx('click');
      this.state = finishUpkeep(this.state);
      if (!this.state.gameOver) this.state = beginPlacement(this.state);
      this.selectedWorkerId = undefined;
      this.persist();
      this.render();
    });
    this.hud.querySelector('#restart')?.addEventListener('click', () => {
      audio.playSfx('click');
      this.returnToTitle();
    });
    this.hud.querySelectorAll<HTMLButtonElement>('.build-option').forEach((button) => {
      button.addEventListener('click', () => this.chooseBuilding(button.dataset.building || undefined));
    });
  }

  // ------------------------------------------------------------- tooltips

  private spotTip(spot: Spot, difficulty: number): string {
    const selected = this.selectedWorker();
    const chance = selected ? successProbability(selected, spot, this.state.assignments, this.state.preview.event) : undefined;
    const rewards = (Object.keys(spot.rewards) as Array<keyof Spot['rewards']>)
      .map((outcome) => {
        const line = spot.rewards[outcome].map((item) => `${resourceIcon(item.resource)}+${item.amount}`).join(' ');
        return `<li><b>${outcomeLabel(outcome)}</b>: ${line || 'ー'}</li>`;
      })
      .join('');
    return `
      <h2>${spot.icon} ${spot.name}</h2>
      <p>${spot.description}</p>
      <p>${statLabel(spot.stat)}判定 / 難易度 ${difficulty} / 定員 ${spot.capacity}
      ${chance !== undefined ? ` / <b>成功率 ${chance}%</b>` : ''}</p>
      <p class="risk">疲労+${spot.risk.fatigue} / 失敗時の負傷率 ${Math.round(spot.risk.injuryChance * 100)}%</p>
      <ul>${rewards}</ul>
    `;
  }

  private workerTip(worker: Worker): string {
    return `
      <h2>${worker.icon} ${worker.name}</h2>
      <p>筋力${worker.stats.strength} / 器用${worker.stats.dexterity} / 知恵${worker.stats.wisdom} / 魅力${worker.stats.charm}</p>
      <p class="traits">${this.traitDetails(worker)}</p>
      <p>疲労 ${worker.fatigue}(判定 -${Math.floor(worker.fatigue / 2)}) / 経験 ${worker.xp}/5</p>
    `;
  }

  private traitDetails(worker: Worker): string {
    return worker.traits
      .map((id) => `<span class="${traits[id].negative ? 'neg' : 'pos'}">${traits[id].name}</span> ${traits[id].description}`)
      .join('<br>');
  }

  // ------------------------------------------------------------ resolution

  private async playResolution(): Promise<void> {
    if (this.resolving) return;
    this.resolving = true;
    this.skipResolution = false;
    this.selectedWorkerId = undefined;
    this.pendingWorkshop = false;
    this.state = resolveAssignments(this.state);
    this.renderHud();
    for (const result of this.state.lastResults) {
      if (this.skipResolution) break;
      await this.animateResult(result);
    }
    this.effectLayer.removeAll(true);
    this.resolving = false;
    this.persist();
    this.render();
  }

  private animateResult(result: ResolutionResult): Promise<void> {
    const [x, y] = SPOT_POSITIONS[result.spotId] ?? [640, 300];
    const style = OUTCOME_STYLE[result.outcome] ?? OUTCOME_STYLE.failure;

    return new Promise((resolve) => {
      const dice1 = this.makeDie(x - 26, y - 92);
      const dice2 = this.makeDie(x + 26, y - 92);
      audio.playSfx('dice');
      let ticks = 0;
      const roller = this.time.addEvent({
        delay: 70,
        repeat: 7,
        callback: () => {
          ticks += 1;
          dice1.face(Phaser.Math.Between(1, 6));
          dice2.face(Phaser.Math.Between(1, 6));
        },
      });

      this.time.delayedCall(620, () => {
        roller.remove();
        // 確定した目を結果段階の色で描き、着地の弾みを付ける
        dice1.face(result.dice[0], style.face, style.num);
        dice2.face(result.dice[1], style.face, style.num);
        for (const die of [dice1, dice2]) {
          this.tweens.add({ targets: die.container, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.easeOut' });
        }
        this.spawnOutcomeBurst(x, y - 92, result.outcome, style.num);

        // 結果音: 工房の成功は建設音、それ以外は成否に応じた音
        const succeeded = result.outcome === 'success' || result.outcome === 'criticalSuccess';
        if (result.spotId === 'workshop' && succeeded) {
          audio.playSfx('build');
        } else {
          audio.playSfx(result.outcome);
        }

        const banner = this.makeBanner(x, y - 134, `${outcomeLabel(result.outcome)}  ${result.total} vs ${result.target}`, style);
        this.effectLayer.add(banner);
        banner.setScale(0.4);
        this.tweens.add({ targets: banner, scale: 1, duration: 200, ease: 'Back.easeOut' });

        const floats: string[] = [
          ...result.rewards.map((reward) => `+${reward.amount}${resourceIcon(reward.resource)}`),
          ...result.spent.map((cost) => `-${cost.amount}${resourceIcon(cost.resource)}`),
          ...result.notes,
        ];
        floats.forEach((line, index) => {
          const float = this.add.text(x, y - 48 + index * 22, line, {
            fontFamily: FONT, fontSize: '16px',
            color: line.startsWith('-') ? '#ff9d7a' : line.startsWith('+') ? '#9fe3a0' : '#f5ead0',
            stroke: '#141009', strokeThickness: 4, fontStyle: '700',
          }).setOrigin(0.5).setAlpha(0);
          this.effectLayer.add(float);
          this.tweens.add({ targets: float, alpha: 1, y: float.y - 14, delay: 120 + index * 90, duration: 320 });
        });

        this.time.delayedCall(this.skipResolution ? 100 : 1050 + floats.length * 90, () => {
          this.tweens.add({
            targets: [dice1.container, dice2.container, banner],
            alpha: 0,
            duration: 200,
            onComplete: () => {
              dice1.container.destroy();
              dice2.container.destroy();
              this.effectLayer.removeAll(true);
              this.renderHud();
              resolve();
            },
          });
        });
      });
    });
  }

  /**
   * 角丸・ピップ表示のダイスを作る。face(value, faceColor?, pipColor?) で目を描き直す。
   * 転がっている間はランダムな目を、確定時は結果段階の色で描画する。
   */
  private makeDie(x: number, y: number): { container: Phaser.GameObjects.Container; face: (value: number, faceColor?: number, pipColor?: number) => void } {
    const container = this.add.container(x, y).setDepth(60);
    const g = this.add.graphics();
    container.add(g);
    const s = 40;
    const face = (value: number, faceColor = 0xf6ecd6, pipColor = 0x241a12): void => {
      g.clear();
      g.fillStyle(0x000000, 0.35);
      g.fillRoundedRect(-s / 2 + 2, -s / 2 + 3, s, s, 9);
      g.fillStyle(faceColor, 1);
      g.fillRoundedRect(-s / 2, -s / 2, s, s, 9);
      g.fillStyle(0xffffff, 0.22);
      g.fillRoundedRect(-s / 2, -s / 2, s, 15, { tl: 9, tr: 9, bl: 0, br: 0 });
      g.lineStyle(2, 0x2a2018, 1);
      g.strokeRoundedRect(-s / 2, -s / 2, s, s, 9);
      g.fillStyle(pipColor, 1);
      for (const [px, py] of PIP_LAYOUT[value] ?? PIP_LAYOUT[1]) {
        g.fillCircle(px * 10, py * 10, 3.6);
      }
    };
    face(1);
    this.tweens.add({ targets: container, angle: { from: -9, to: 9 }, duration: 90, yoyo: true, repeat: 4 });
    return { container, face };
  }

  /** 結果段階のラベルを角丸の台座付きで作る。 */
  private makeBanner(x: number, y: number, label: string, style: { hex: string; num: number }): Phaser.GameObjects.Container {
    const container = this.add.container(x, y).setDepth(61);
    const text = this.add.text(0, 0, label, {
      fontFamily: FONT, fontSize: '24px', color: style.hex, fontStyle: '900',
      stroke: '#141009', strokeThickness: 5,
    }).setOrigin(0.5);
    const bw = text.width + 30;
    const bh = text.height + 12;
    const bg = this.add.graphics();
    bg.fillStyle(0x14100a, 0.86);
    bg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 10);
    bg.lineStyle(2, style.num, 0.9);
    bg.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 10);
    container.add([bg, text]);
    return container;
  }

  /** 確定時に広がる光の輪。大成功/大失敗はより強く演出する。 */
  private spawnOutcomeBurst(x: number, y: number, outcome: string, color: number): void {
    const strong = outcome === 'criticalSuccess' || outcome === 'criticalFailure';
    const ring = this.add.graphics().setDepth(59);
    ring.lineStyle(strong ? 4 : 2.5, color, 0.9);
    ring.strokeCircle(0, 0, 20);
    ring.setPosition(x, y);
    this.effectLayer.add(ring);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.4, to: strong ? 2.6 : 1.8 },
      alpha: { from: 0.9, to: 0 },
      duration: strong ? 620 : 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
    if (strong) {
      const flash = this.add.graphics().setDepth(58);
      flash.fillStyle(color, outcome === 'criticalSuccess' ? 0.14 : 0.12);
      flash.fillRect(0, 0, 1280, 720);
      this.effectLayer.add(flash);
      this.tweens.add({ targets: flash, alpha: 0, duration: 360, onComplete: () => flash.destroy() });
    }
  }

  private formatResult(result: ResolutionResult): string {
    const spot = getSpot(result.spotId);
    const worker = this.state.workers.find((candidate) => candidate.id === result.workerId);
    const rewards = result.rewards.map((reward) => `${resourceIcon(reward.resource)}+${reward.amount}`).join(' ');
    const spent = result.spent.map((cost) => `${resourceIcon(cost.resource)}-${cost.amount}`).join(' ');
    const notes = result.notes.length ? `<br><small>${result.notes.join('、')}</small>` : '';
    return `<p class="r-${result.outcome}"><b>${spot?.icon ?? ''}${worker?.name ?? ''}</b> ${outcomeLabel(result.outcome)} ${rewards} ${spent ? `<span class="spent">${spent}</span>` : ''}${notes}</p>`;
  }

  private selectedWorker(): Worker | undefined {
    return this.selectedWorkerId ? this.workerById(this.selectedWorkerId) : undefined;
  }

  private workerById(workerId: string): Worker | undefined {
    return this.state.workers.find((worker) => worker.id === workerId);
  }
}

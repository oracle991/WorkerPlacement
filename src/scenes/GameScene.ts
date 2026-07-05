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
import type { GameState, ResolutionResult, Spot, Worker } from '../core/types';
import { getBuilding } from '../data/buildings';
import { traits, traitNames } from '../data/traits';

const FONT = '"Noto Sans JP", sans-serif';

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
  private pendingWorkshop = false;
  private hoverInfo = '';
  private spotViews: SpotView[] = [];
  private workerViews: Phaser.GameObjects.Container[] = [];
  private effectLayer!: Phaser.GameObjects.Container;
  private skipResolution = false;
  private resolving = false;

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
    this.state = beginPlacement(startGame(this.state));
    this.drawBoard();
    this.render();
  }

  private drawBoard(): void {
    const g = this.add.graphics();
    g.fillGradientStyle(0x1a2b21, 0x1a2b21, 0x0f1a14, 0x0f1a14, 1);
    g.fillRect(0, 0, 1280, 720);
    // 村の地面
    g.fillStyle(0x2c4433, 0.9);
    g.fillRoundedRect(170, 130, 780, 340, 36);
    g.fillStyle(0x35513c, 0.55);
    g.fillRoundedRect(190, 148, 740, 304, 30);
    // 中央の広場
    g.fillStyle(0x4a6a4e, 0.5);
    g.fillCircle(560, 296, 62);
    this.add.text(560, 296, '🏕️', { fontSize: '40px' }).setOrigin(0.5);

    this.effectLayer = this.add.container(0, 0).setDepth(50);
  }

  private render(): void {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__state = this.state;
    }
    this.renderSpots();
    this.renderWorkers();
    this.renderHud();
  }

  // ---------------------------------------------------------------- spots

  private renderSpots(): void {
    for (const view of this.spotViews) view.container.destroy();
    this.spotViews = [];
    const selected = this.selectedWorker();

    for (const spot of availableSpots(this.state.round)) {
      const [x, y] = SPOT_POSITIONS[spot.id] ?? [640, 300];
      const assignedHere = this.state.assignments.filter((assignment) => assignment.spotId === spot.id);
      const full = assignedHere.length >= spot.capacity;
      const difficulty = effectiveDifficulty(spot, this.state.preview.event);
      const modified = difficulty !== spot.difficulty;

      const container = this.add.container(x, y);
      const card = this.add.rectangle(0, 0, 176, 116, full ? 0x55492c : 0x413723, 1);
      card.setStrokeStyle(2, selected && !full ? 0xffd97a : 0x76633c);
      const icon = this.add.text(-60, -30, spot.icon, { fontSize: '34px' }).setOrigin(0.5);
      const name = this.add.text(-30, -44, spot.name, {
        fontFamily: FONT, fontSize: '18px', color: '#f5ead0', fontStyle: '700',
      });
      const info = this.add.text(-30, -18, `${statLabel(spot.stat)} / 難${difficulty}`, {
        fontFamily: FONT, fontSize: '13px', color: modified ? (difficulty > spot.difficulty ? '#ff9d7a' : '#9fe3a0') : '#cbbf9d',
      });
      container.add([card, icon, name, info]);

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
      const container = this.add.container(x, y);

      const card = this.add.rectangle(0, 0, 184, 118, selected ? 0x6b5a2c : assigned ? 0x2c3226 : 0x33402f, 1);
      card.setStrokeStyle(2.5, selected ? 0xffd97a : worker.injured > 0 ? 0xb04f42 : 0x5f7050);
      if (assigned && !selected) card.setAlpha(0.75);
      const icon = this.add.text(-64, -32, worker.icon, { fontSize: '30px' }).setOrigin(0.5);
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
      const xpBar = this.add.rectangle(-78 + (worker.xp / 5) * 60, 50, (worker.xp / 5) * 120, 4, 0x8fd0ff, 0.9).setOrigin(0.5);
      container.add([card, icon, name, stats, traitText, status, xpBar]);

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
    } else {
      this.selectedWorkerId = this.selectedWorkerId === worker.id ? undefined : worker.id;
    }
    this.render();
  }

  private onSpotClicked(spot: Spot): void {
    if (this.state.phase !== 'placement' || this.resolving || !this.selectedWorkerId) return;
    if (spot.id === 'workshop') {
      this.pendingWorkshop = true;
      this.renderHud();
      return;
    }
    this.state = assignWorker(this.state, this.selectedWorkerId, spot.id);
    this.selectedWorkerId = undefined;
    this.render();
  }

  private chooseBuilding(buildingId?: string): void {
    if (!this.selectedWorkerId) return;
    this.state = assignWorker(this.state, this.selectedWorkerId, 'workshop', buildingId);
    this.selectedWorkerId = undefined;
    this.pendingWorkshop = false;
    this.render();
  }

  // ------------------------------------------------------------------ hud

  /**
   * ホバー時はパネルの中身だけを差し替える。
   * HUD全体をinnerHTMLで作り直すと、クリック途中のボタンDOMが
   * mousedownとmouseupの間に消えてクリックが不発になるため。
   */
  private updatePanelOnly(): void {
    if (this.pendingWorkshop) return; // 施設選択中はホバーで邪魔しない
    const panel = this.hud.querySelector('.panel');
    if (panel) panel.innerHTML = this.renderPanel();
  }

  private renderHud(): void {
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
    this.hud.querySelector('#resolve')?.addEventListener('click', () => void this.playResolution());
    this.hud.querySelector('#upkeep')?.addEventListener('click', () => {
      this.state = finishUpkeep(this.state);
      if (!this.state.gameOver) this.state = beginPlacement(this.state);
      this.selectedWorkerId = undefined;
      this.render();
    });
    this.hud.querySelector('#restart')?.addEventListener('click', () => {
      this.state = beginPlacement(startGame(createGame(String(Date.now()))));
      this.selectedWorkerId = undefined;
      this.pendingWorkshop = false;
      this.effectLayer.removeAll(true);
      this.render();
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
    this.render();
  }

  private animateResult(result: ResolutionResult): Promise<void> {
    const [x, y] = SPOT_POSITIONS[result.spotId] ?? [640, 300];
    const outcomeColors: Record<string, string> = {
      criticalSuccess: '#ffd97a',
      success: '#9fe3a0',
      failure: '#b9b9b9',
      criticalFailure: '#ff7a7a',
    };

    return new Promise((resolve) => {
      const dice1 = this.makeDie(x - 24, y - 90);
      const dice2 = this.makeDie(x + 24, y - 90);
      let ticks = 0;
      const roller = this.time.addEvent({
        delay: 70,
        repeat: 7,
        callback: () => {
          ticks += 1;
          const rand = () => String(Phaser.Math.Between(1, 6));
          (dice1.getAt(1) as Phaser.GameObjects.Text).setText(ticks > 7 ? String(result.dice[0]) : rand());
          (dice2.getAt(1) as Phaser.GameObjects.Text).setText(ticks > 7 ? String(result.dice[1]) : rand());
        },
      });

      this.time.delayedCall(620, () => {
        roller.remove();
        (dice1.getAt(1) as Phaser.GameObjects.Text).setText(String(result.dice[0]));
        (dice2.getAt(1) as Phaser.GameObjects.Text).setText(String(result.dice[1]));

        const banner = this.add.text(x, y - 130, `${outcomeLabel(result.outcome)}  ${result.total} vs ${result.target}`, {
          fontFamily: FONT, fontSize: '24px', color: outcomeColors[result.outcome],
          fontStyle: '900', stroke: '#141009', strokeThickness: 5,
        }).setOrigin(0.5).setScale(0.4);
        this.effectLayer.add(banner);
        this.tweens.add({ targets: banner, scale: 1, duration: 180, ease: 'Back.easeOut' });

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
            targets: [dice1, dice2, banner],
            alpha: 0,
            duration: 200,
            onComplete: () => {
              dice1.destroy();
              dice2.destroy();
              this.effectLayer.removeAll(true);
              this.renderHud();
              resolve();
            },
          });
        });
      });
    });
  }

  private makeDie(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y).setDepth(60);
    const body = this.add.rectangle(0, 0, 38, 38, 0xf5ead0, 1);
    body.setStrokeStyle(2, 0x141009);
    const num = this.add.text(0, 0, '?', {
      fontFamily: FONT, fontSize: '22px', color: '#141009', fontStyle: '900',
    }).setOrigin(0.5);
    container.add([body, num]);
    this.tweens.add({ targets: container, angle: { from: -8, to: 8 }, duration: 90, yoyo: true, repeat: 4 });
    return container;
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

import Phaser from 'phaser';
import {
  assignWorker,
  availableSpots,
  beginPlacement,
  createGame,
  finishUpkeep,
  getSpot,
  outcomeLabel,
  resourceLabel,
  resolveAssignments,
  startGame,
  statLabel,
  successProbability,
  unassignWorker,
} from '../core/game';
import type { GameState, ResolutionResult, Spot, Worker } from '../core/types';
import { traitNames } from '../data/traits';

interface SpotView {
  spot: Spot;
  container: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private state: GameState = createGame('frontier-prototype');
  private hud!: HTMLElement;
  private selectedWorkerId: string | undefined;
  private spotViews: SpotView[] = [];
  private workerViews = new Map<string, Phaser.GameObjects.Container>();
  private resultLayer!: Phaser.GameObjects.Container;
  private skipResolution = false;

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
      this.render();
    });
    this.state = startGame(this.state);
    this.drawBoard();
    this.render();
  }

  private drawBoard(): void {
    this.add.rectangle(640, 360, 1280, 720, 0x203425);
    this.add.ellipse(640, 345, 780, 430, 0x3f6b4b, 0.55);
    this.add.ellipse(640, 365, 690, 345, 0x597f54, 0.45);
    this.add.text(640, 84, '辺境開拓団(仮)', {
      fontFamily: '"Noto Sans JP", sans-serif',
      fontSize: '26px',
      color: '#f8f1d2',
      fontStyle: '900',
    }).setOrigin(0.5);

    this.resultLayer = this.add.container(0, 0);
  }

  private render(): void {
    this.renderSpots();
    this.renderWorkers();
    this.renderHud();
  }

  private renderSpots(): void {
    for (const view of this.spotViews) view.container.destroy();
    this.spotViews = [];

    const positions = [
      [360, 250],
      [520, 205],
      [695, 205],
      [865, 250],
      [450, 410],
      [640, 435],
      [830, 410],
      [640, 300],
    ];
    availableSpots(this.state.round).forEach((spot, index) => {
      const [x, y] = positions[index];
      const assigned = this.state.assignments.find((assignment) => assignment.spotId === spot.id);
      const container = this.add.container(x, y);
      const base = this.add.rectangle(0, 0, 142, 92, assigned ? 0xe0be63 : 0xf1df9f, 1);
      base.setStrokeStyle(3, this.selectedWorkerId ? 0xf7f0c8 : 0x815f32);
      base.setInteractive({ useHandCursor: true });
      const icon = this.add.text(0, -18, spot.icon, { fontSize: '30px' }).setOrigin(0.5);
      const label = this.add.text(0, 22, spot.name, {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '17px',
        color: '#2a2118',
        fontStyle: '700',
      }).setOrigin(0.5);
      const workerLabel = this.add.text(49, -33, assigned ? this.workerName(assigned.workerId) : '', {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: '#2d1d12',
      }).setOrigin(0.5);
      container.add([base, icon, label, workerLabel]);
      base.on('pointerdown', () => this.placeSelectedWorker(spot.id));
      base.on('pointerover', () => this.showSpotTip(spot));
      base.on('pointerout', () => this.renderHud());
      this.spotViews.push({ spot, container, base, label });
    });
  }

  private renderWorkers(): void {
    for (const view of this.workerViews.values()) view.destroy();
    this.workerViews.clear();

    this.state.workers.forEach((worker, index) => {
      const assigned = this.state.assignments.some((assignment) => assignment.workerId === worker.id);
      const x = 250 + index * 170;
      const y = 630;
      const selected = this.selectedWorkerId === worker.id;
      const container = this.add.container(x, y);
      const card = this.add.rectangle(0, 0, 150, 86, selected ? 0xf6d56e : assigned ? 0xb4ad91 : 0xf7efd2, 1);
      card.setStrokeStyle(3, selected ? 0xffffff : 0x735d35);
      card.setInteractive({ useHandCursor: true });
      const icon = this.add.text(-52, -22, worker.icon, { fontSize: '28px' }).setOrigin(0.5);
      const name = this.add.text(-18, -25, worker.name, {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '17px',
        color: '#2a2118',
        fontStyle: '700',
      });
      const stats = this.add.text(-62, 4, `筋${worker.stats.strength} 器${worker.stats.dexterity} 知${worker.stats.wisdom} 魅${worker.stats.charm}`, {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: '#3f3326',
      });
      const state = this.add.text(-62, 25, `疲労${worker.fatigue} 負傷${worker.injured}`, {
        fontFamily: '"Noto Sans JP", sans-serif',
        fontSize: '12px',
        color: worker.injured > 0 ? '#9d2525' : '#3f3326',
      });
      container.add([card, icon, name, stats, state]);
      card.on('pointerdown', () => this.selectWorker(worker.id));
      card.on('pointerover', () => this.showWorkerTip(worker));
      card.on('pointerout', () => this.renderHud());
      this.workerViews.set(worker.id, container);
    });
  }

  private renderHud(extra = ''): void {
    const resources = this.state.resources;
    const canResolve = this.state.phase === 'placement' && this.state.assignments.length > 0;
    const selected = this.selectedWorkerId ? this.state.workers.find((worker) => worker.id === this.selectedWorkerId) : undefined;
    const resultText = this.state.lastResults.map((result) => this.formatResult(result)).join('');
    this.hud.innerHTML = `
      <header class="topbar">
        <div class="pill">R${this.state.round}/${this.state.maxRounds}</div>
        <div class="pill">${this.state.preview.seasonLabel}</div>
        <div class="resources">
          <span>食料 ${resources.food}</span>
          <span>木材 ${resources.wood}</span>
          <span>鉱石 ${resources.ore}</span>
          <span>金貨 ${resources.gold}</span>
          <span>繁栄 ${resources.prosperity}/${this.state.targetProsperity}</span>
        </div>
      </header>
      <aside class="panel ${this.state.phase === 'result' ? 'result' : ''}">
        ${this.renderPanel(extra, selected, resultText)}
      </aside>
      <footer class="actions">
        <button id="prepare">準備</button>
        <button id="resolve" ${canResolve ? '' : 'disabled'}>解決</button>
        <button id="upkeep" ${this.state.phase === 'resolution' ? '' : 'disabled'}>維持へ</button>
        <button id="restart">新規</button>
      </footer>
    `;
    this.bindHudButtons();
  }

  private renderPanel(extra: string, selected: Worker | undefined, resultText: string): string {
    if (this.state.phase === 'result') {
      const rank = this.state.resources.prosperity >= 36 ? 'S' : this.state.resources.prosperity >= 30 ? 'A' : this.state.resources.prosperity >= 24 ? 'B' : 'C';
      return `
        <h2>${this.state.winner ? '開拓成功' : '開拓失敗'}</h2>
        <p>繁栄度 ${this.state.resources.prosperity}/${this.state.targetProsperity} / ランク ${rank}</p>
        <p>${this.state.winner ? '村は辺境で生き残る足場を得た。' : '村はまだ十分な支えを持てていない。'}</p>
      `;
    }
    if (extra) return extra;
    if (selected) {
      return `<h2>${selected.icon} ${selected.name}</h2><p>${traitNames(selected)}</p><p>配置したいスポットをクリック。</p>`;
    }
    return `
      <h2>${this.state.preview.seasonEvent}</h2>
      <p>ワーカーを選び、村のスポットへ配置してください。成功率と報酬はホバーで確認できます。</p>
      <div class="results">${resultText}</div>
      <ol>${this.state.log.slice(0, 5).map((line) => `<li>${line}</li>`).join('')}</ol>
    `;
  }

  private bindHudButtons(): void {
    this.hud.querySelector('#prepare')?.addEventListener('click', () => {
      this.state = beginPlacement(this.state);
      this.selectedWorkerId = undefined;
      this.render();
    });
    this.hud.querySelector('#resolve')?.addEventListener('click', () => {
      this.playResolution();
    });
    this.hud.querySelector('#upkeep')?.addEventListener('click', () => {
      this.state = finishUpkeep(this.state);
      this.selectedWorkerId = undefined;
      this.render();
    });
    this.hud.querySelector('#restart')?.addEventListener('click', () => {
      this.state = beginPlacement(startGame(createGame(String(Date.now()))));
      this.selectedWorkerId = undefined;
      this.resultLayer.removeAll(true);
      this.render();
    });
  }

  private selectWorker(workerId: string): void {
    if (this.state.phase !== 'placement') this.state = beginPlacement(this.state);
    const worker = this.state.workers.find((candidate) => candidate.id === workerId);
    if (!worker || worker.injured > 0) return;
    if (this.state.assignments.some((assignment) => assignment.workerId === workerId)) {
      this.state = unassignWorker(this.state, workerId);
      this.selectedWorkerId = undefined;
    } else {
      this.selectedWorkerId = workerId;
    }
    this.render();
  }

  private placeSelectedWorker(spotId: string): void {
    if (!this.selectedWorkerId) return;
    this.state = assignWorker(this.state, this.selectedWorkerId, spotId);
    this.selectedWorkerId = undefined;
    this.render();
  }

  private showSpotTip(spot: Spot): void {
    const worker = this.selectedWorkerId ? this.state.workers.find((candidate) => candidate.id === this.selectedWorkerId) : undefined;
    const chance = worker ? successProbability(worker, spot, this.state.assignments) : undefined;
    const rewards = Object.entries(spot.rewards)
      .map(([outcome, reward]) => `<li>${outcomeLabel(outcome as never)}: ${reward.map((item) => `${resourceLabel(item.resource)}+${item.amount}`).join(' / ') || 'なし'}</li>`)
      .join('');
    this.renderHud(`
      <h2>${spot.icon} ${spot.name}</h2>
      <p>${spot.description}</p>
      <p>${statLabel(spot.stat)} / 難易度 ${spot.difficulty}${chance !== undefined ? ` / 成功率 ${chance}%` : ''}</p>
      <ul>${rewards}</ul>
    `);
  }

  private showWorkerTip(worker: Worker): void {
    this.renderHud(`
      <h2>${worker.icon} ${worker.name}</h2>
      <p>${traitNames(worker)}</p>
      <p>筋力${worker.stats.strength} 器用${worker.stats.dexterity} 知恵${worker.stats.wisdom} 魅力${worker.stats.charm}</p>
      <p>疲労 ${worker.fatigue} / 負傷 ${worker.injured} / 経験 ${worker.xp}</p>
    `);
  }

  private async playResolution(): Promise<void> {
    this.skipResolution = false;
    this.state = resolveAssignments(this.state);
    this.render();
    const results = [...this.state.lastResults];
    this.resultLayer.removeAll(true);
    for (const result of results) {
      if (this.skipResolution) break;
      await this.animateDice(result);
    }
    this.render();
  }

  private animateDice(result: ResolutionResult): Promise<void> {
    const spot = this.spotViews.find((view) => view.spot.id === result.spotId);
    const x = spot?.container.x ?? 640;
    const y = (spot?.container.y ?? 320) - 85;
    const color = result.outcome === 'criticalSuccess' ? '#ffe27a' : result.outcome === 'success' ? '#d8f39b' : result.outcome === 'criticalFailure' ? '#ff8080' : '#d8d8d8';
    const text = this.add.text(x, y, `${result.dice[0]} + ${result.dice[1]}\n${outcomeLabel(result.outcome)}`, {
      fontFamily: '"Noto Sans JP", sans-serif',
      fontSize: '26px',
      color,
      align: 'center',
      stroke: '#1d1510',
      strokeThickness: 5,
      fontStyle: '900',
    }).setOrigin(0.5);
    this.resultLayer.add(text);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: text,
        y: y - 34,
        scale: 1.15,
        alpha: 0,
        duration: 950,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          text.destroy();
          resolve();
        },
      });
    });
  }

  private formatResult(result: ResolutionResult): string {
    const rewards = result.rewards.map((reward) => `${resourceLabel(reward.resource)}+${reward.amount}`).join(' / ') || '報酬なし';
    const notes = result.notes.length ? ` (${result.notes.join('、')})` : '';
    return `<p>${outcomeLabel(result.outcome)}: ${rewards}${notes}</p>`;
  }

  private workerName(workerId: string): string {
    return this.state.workers.find((worker) => worker.id === workerId)?.name ?? '';
  }
}

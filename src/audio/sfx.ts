import type { Season } from '../core/types';

/**
 * Web Audio API による自前サウンド合成。外部音源ファイルは一切使わない
 * (完全静的サイト・依存追加ゼロの方針)。
 *
 * - SE はオシレータ + エンベロープ(+ノイズ)で都度合成する。
 * - BGM はパッド和音 + 簡単なアルペジオを先読みスケジューラでループ再生する。
 * - AudioContext はブラウザの自動再生ポリシーに従い、ユーザーの最初の操作
 *   (クリック/キー入力)で resume する。それまで音は鳴らないがエラーも出さない。
 * - ミュート状態は localStorage に保存(セーブデータとは別キー)。
 *
 * GameScene からは `audio.playSfx('dice')` のような薄い API で呼ぶ。
 * ゲームロジック(src/core/)には一切依存しない。
 */

export type SfxName =
  | 'click'
  | 'place'
  | 'unplace'
  | 'dice'
  | 'success'
  | 'criticalSuccess'
  | 'failure'
  | 'criticalFailure'
  | 'build'
  | 'victory'
  | 'defeat';

/** ミュート設定の localStorage キー(セーブデータの `frontier-save-v1` とは別)。 */
const MUTE_KEY = 'frontier-muted-v1';

interface ToneOptions {
  freq: number;
  /** 開始オフセット秒(ctx.currentTime からの相対) */
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  /** 終端周波数(グライド)。指定時 freq から線形に推移 */
  toFreq?: number;
  destination?: AudioNode;
}

/** 季節ごとの BGM 雰囲気(キー・テンポ・音色を少し変える)。 */
interface SeasonMusic {
  /** ルート周波数(パッド和音の最低音) */
  root: number;
  /** ルートからの半音オフセットで作る和音 */
  chord: number[];
  /** アルペジオに使う半音オフセット */
  arp: number[];
  /** 1小節の長さ(秒)。小さいほど速い */
  bar: number;
  padType: OscillatorType;
  leadType: OscillatorType;
}

const SEMITONE = Math.pow(2, 1 / 12);
const st = (base: number, semitones: number): number => base * Math.pow(SEMITONE, semitones);

// 各季節: 春=Aマイナー系で穏やか、夏=Cメジャーで明るく速め、
// 秋=Dマイナーでしっとり、冬=Eマイナー低めで静かにゆっくり。
const SEASON_MUSIC: Record<Season, SeasonMusic> = {
  spring: { root: 220.0, chord: [0, 7, 12, 16], arp: [0, 4, 7, 12, 7, 4], bar: 4.0, padType: 'triangle', leadType: 'triangle' },
  summer: { root: 261.63, chord: [0, 4, 7, 12], arp: [0, 4, 7, 12, 16, 12], bar: 3.4, padType: 'triangle', leadType: 'sine' },
  autumn: { root: 196.0, chord: [0, 3, 7, 10], arp: [0, 3, 7, 10, 7, 3], bar: 4.6, padType: 'sine', leadType: 'triangle' },
  winter: { root: 164.81, chord: [0, 3, 7, 12], arp: [0, 7, 3, 12], bar: 5.4, padType: 'sine', leadType: 'sine' },
};

class AudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private bgmBus?: GainNode;
  private muted = false;

  // BGM スケジューラ
  private bgmOn = false;
  private bgmSeason: Season = 'spring';
  private bgmTimer?: number;
  private nextBarTime = 0;
  private bgmNodes: AudioScheduledSourceNode[] = [];

  constructor() {
    this.muted = this.readMuted();
    // 最初のユーザー操作(click/keydown)で resume する(自動再生ポリシー対応)。
    // それまでは suspended のまま音を鳴らさないだけで、エラーは出さない。
    // リスナーは常設(タブ非表示などで再suspendされても次の操作で再開できる)。
    if (typeof window !== 'undefined') {
      const unlock = () => this.unlock();
      window.addEventListener('click', unlock, { once: false });
      window.addEventListener('keydown', unlock, { once: false });
    }
  }

  // -------------------------------------------------------------- lifecycle

  /** AudioContext を用意する。まだユーザー操作前なら suspended のままでよい。 */
  private ensureContext(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return undefined;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(ctx.destination);
      const sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);
      const bgmBus = ctx.createGain();
      bgmBus.gain.value = 0.32; // BGM は SE より控えめ
      bgmBus.connect(master);
      this.ctx = ctx;
      this.master = master;
      this.sfxBus = sfxBus;
      this.bgmBus = bgmBus;
      return ctx;
    } catch {
      return undefined;
    }
  }

  /** ユーザー操作時に呼ぶ。AudioContext を resume し、保留中の BGM を開始する。 */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    if (this.bgmOn) this.scheduleBgm();
  }

  // ----------------------------------------------------------------- mute

  isMuted(): boolean {
    return this.muted;
  }

  /** ミュートを切り替え、新しい状態を返す。localStorage へ保存する。 */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.writeMuted(muted);
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.02);
    }
  }

  private readMuted(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private writeMuted(muted: boolean): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // 無視(音設定は補助機能)
    }
  }

  // ---------------------------------------------------------- synth helpers

  private tone(opts: ToneOptions): void {
    const ctx = this.ctx;
    const bus = opts.destination ?? this.sfxBus;
    if (!ctx || !bus) return;
    const start = ctx.currentTime + (opts.at ?? 0);
    const dur = opts.dur ?? 0.2;
    const attack = Math.min(opts.attack ?? 0.008, dur * 0.5);
    const release = Math.min(opts.release ?? 0.08, dur);
    const peak = opts.gain ?? 0.2;

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.toFreq !== undefined) osc.frequency.linearRampToValueAtTime(opts.toFreq, start + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, start + attack);
    env.gain.setValueAtTime(peak, start + Math.max(attack, dur - release));
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(env);
    env.connect(bus);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private noise(at: number, dur: number, gain: number, freq: number, q = 1): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const start = ctx.currentTime + at;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, Math.max(1, frames), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(bus);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  // ------------------------------------------------------------------ sfx

  /** 効果音を鳴らす。context 未 resume やミュートでも安全(エラーを出さない)。 */
  playSfx(name: SfxName): void {
    const ctx = this.ensureContext();
    if (!ctx || this.muted) return;
    if (ctx.state === 'suspended') return; // 操作前は鳴らさない(エラーも出さない)
    switch (name) {
      case 'click':
        this.tone({ freq: 520, toFreq: 640, type: 'triangle', dur: 0.07, gain: 0.16, release: 0.05 });
        break;
      case 'place':
        // 木のコマを置くような、丸く上がる2音
        this.tone({ freq: 392, type: 'triangle', dur: 0.09, gain: 0.2 });
        this.tone({ freq: 587, at: 0.05, type: 'triangle', dur: 0.11, gain: 0.18 });
        this.noise(0, 0.05, 0.06, 900, 0.7);
        break;
      case 'unplace':
        // 引き戻す、下がる2音
        this.tone({ freq: 494, type: 'triangle', dur: 0.08, gain: 0.16 });
        this.tone({ freq: 330, at: 0.05, type: 'triangle', dur: 0.1, gain: 0.15 });
        break;
      case 'dice': {
        // 最重要演出。木のダイスが転がるコロコロ音(短いノイズの連打)
        for (let i = 0; i < 7; i += 1) {
          this.noise(i * 0.06, 0.045, 0.12, 1400 + Math.random() * 700, 3);
        }
        this.tone({ freq: 300, at: 0.42, type: 'triangle', dur: 0.08, gain: 0.12 });
        break;
      }
      case 'success': {
        // 明るい上行3和音(温かい木管風)
        const base = 523.25;
        [0, 4, 7].forEach((s, i) => this.tone({ freq: st(base, s), at: i * 0.05, type: 'triangle', dur: 0.24, gain: 0.18, release: 0.15 }));
        break;
      }
      case 'criticalSuccess': {
        // 華やか。分散和音 + 高音のきらめき
        const base = 523.25;
        [0, 4, 7, 12, 16, 19].forEach((s, i) =>
          this.tone({ freq: st(base, s), at: i * 0.06, type: 'triangle', dur: 0.32, gain: 0.17, release: 0.22 }),
        );
        this.tone({ freq: st(base, 24), at: 0.42, type: 'sine', dur: 0.5, gain: 0.12, release: 0.4 });
        break;
      }
      case 'failure':
        // 軽い下行2音(重すぎない、次に切り替わる程度)
        this.tone({ freq: 349.23, type: 'triangle', dur: 0.16, gain: 0.15 });
        this.tone({ freq: 293.66, at: 0.11, type: 'triangle', dur: 0.2, gain: 0.14, release: 0.14 });
        break;
      case 'criticalFailure':
        // 重い。低い減5度 + ノイズの落下感
        this.tone({ freq: 174.61, type: 'sawtooth', dur: 0.4, gain: 0.16, release: 0.3 });
        this.tone({ freq: 123.47, at: 0.02, type: 'sawtooth', dur: 0.45, gain: 0.14, release: 0.32 });
        this.tone({ freq: 246.94, toFreq: 130, at: 0, type: 'triangle', dur: 0.5, gain: 0.1, release: 0.4 });
        this.noise(0, 0.35, 0.08, 220, 0.6);
        break;
      case 'build': {
        // 施設建設。トントンと打ち込む音 + 完成の上昇
        this.noise(0, 0.05, 0.14, 380, 1.2);
        this.noise(0.12, 0.05, 0.14, 380, 1.2);
        this.tone({ freq: 392, at: 0.24, type: 'triangle', dur: 0.14, gain: 0.18 });
        this.tone({ freq: 587, at: 0.34, type: 'triangle', dur: 0.22, gain: 0.18, release: 0.16 });
        break;
      }
      case 'victory': {
        // 勝利ジングル。明るいファンファーレ(I→V→I の上行)
        const base = 523.25;
        const seq: Array<[number, number]> = [
          [0, 0], [4, 0.14], [7, 0.28], [12, 0.42], [7, 0.6], [12, 0.72], [16, 0.9],
        ];
        seq.forEach(([s, at]) => this.tone({ freq: st(base, s), at, type: 'triangle', dur: 0.34, gain: 0.2, release: 0.2 }));
        this.tone({ freq: st(base, 19), at: 1.05, type: 'triangle', dur: 0.7, gain: 0.18, release: 0.5 });
        this.tone({ freq: st(base, 12), at: 1.05, type: 'sine', dur: 0.7, gain: 0.12, release: 0.5 });
        break;
      }
      case 'defeat': {
        // 敗北ジングル。低く沈む短調の下行
        const base = 392.0;
        const seq: Array<[number, number]> = [[0, 0], [-2, 0.22], [-4, 0.44], [-7, 0.7]];
        seq.forEach(([s, at]) => this.tone({ freq: st(base, s), at, type: 'sine', dur: 0.4, gain: 0.17, release: 0.28 }));
        this.tone({ freq: st(base, -12), at: 0.7, type: 'sine', dur: 0.9, gain: 0.15, release: 0.7 });
        this.tone({ freq: st(base, -9), at: 0.7, type: 'triangle', dur: 0.9, gain: 0.09, release: 0.7 });
        break;
      }
    }
  }

  // ------------------------------------------------------------------ bgm

  /** BGM ループを開始(または季節を更新)する。ミュートや未 resume でも安全。 */
  startBgm(season: Season): void {
    this.bgmSeason = season;
    if (this.bgmOn) return;
    this.bgmOn = true;
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'running') this.scheduleBgm();
    // suspended のときは unlock() で開始される
  }

  /** 再生中の BGM の季節だけ差し替える(次の小節から反映)。 */
  setBgmSeason(season: Season): void {
    this.bgmSeason = season;
  }

  stopBgm(): void {
    this.bgmOn = false;
    if (this.bgmTimer !== undefined) {
      clearTimeout(this.bgmTimer);
      this.bgmTimer = undefined;
    }
    for (const node of this.bgmNodes) {
      try {
        node.stop();
      } catch {
        // 既に停止済み
      }
    }
    this.bgmNodes = [];
  }

  /** 先読みスケジューラ。数小節先まで先読みして音を並べ、setTimeout で継続する。 */
  private scheduleBgm(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bgmOn) return;
    if (this.bgmTimer !== undefined) return; // 二重起動防止
    this.nextBarTime = Math.max(this.nextBarTime, ctx.currentTime + 0.1);

    const tick = () => {
      const c = this.ctx;
      if (!c || !this.bgmOn) return;
      // 先読み: 現在時刻 + 1.5 秒以内に始まる小節を全部予約する
      while (this.nextBarTime < c.currentTime + 1.5) {
        this.scheduleBar(this.nextBarTime);
        this.nextBarTime += SEASON_MUSIC[this.bgmSeason].bar;
      }
      this.bgmTimer = window.setTimeout(tick, 400);
    };
    tick();
  }

  /** 1小節ぶんの音(パッド和音 + アルペジオ)を予約する。 */
  private scheduleBar(at: number): void {
    const ctx = this.ctx;
    const bus = this.bgmBus;
    if (!ctx || !bus) return;
    const m = SEASON_MUSIC[this.bgmSeason];

    // パッド和音: 小節いっぱい伸ばす柔らかい持続音
    for (const semi of m.chord) {
      const freq = st(m.root, semi);
      this.tone({
        freq,
        at: at - ctx.currentTime,
        dur: m.bar * 0.98,
        type: m.padType,
        gain: 0.05,
        attack: m.bar * 0.25,
        release: m.bar * 0.4,
        destination: bus,
      });
    }

    // アルペジオ: 小節を等分して1音ずつ。柔らかいリード。
    const steps = m.arp.length;
    const stepDur = m.bar / steps;
    m.arp.forEach((semi, i) => {
      const freq = st(m.root, semi + 12); // 1オクターブ上
      this.tone({
        freq,
        at: at - ctx.currentTime + i * stepDur,
        dur: stepDur * 0.9,
        type: m.leadType,
        gain: 0.045,
        attack: 0.02,
        release: stepDur * 0.6,
        destination: bus,
      });
    });
  }
}

/** シングルトン。GameScene からはこれを import して使う。 */
export const audio = new AudioEngine();

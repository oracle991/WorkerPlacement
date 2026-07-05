---
name: verify
description: このリポジトリ(Vite+Phaserブラウザゲーム)の変更をヘッドレスブラウザで実機検証する手順。
---

# 検証手順

## 起動
```bash
npm run dev   # http://127.0.0.1:5173 (バックグラウンドで起動)
```

## ブラウザ操作(Playwright + システムのEdge)
ブラウザのダウンロードは不要。scratchpadに `npm i playwright` して:
```js
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
```

- ゲーム盤面は canvas。クリックは 1280×720 のゲーム座標を canvas の
  boundingBox 比率でスケールして `canvas.click({ position })`。
- スポット座標は `src/scenes/GameScene.ts` の `SPOT_POSITIONS`。
- ワーカーカードは y=622、x は `startX = 640 - (n-1)*spacing/2`、
  `spacing = min(200, 960/n)`。
- HUD(資源バー・パネル・ボタン)はHTMLオーバーレイ。`#resolve` `#upkeep`
  `#restart` `.build-option` `.panel` `.topbar` `.eventbar` で操作/読取。
- devモードでは `window.__state` に GameState が公開される(アサート用)。

## 検証すべきフロー
1. 配置: ワーカー選択 → スポットカードに成功率%が出る → 配置
2. 工房: ワーカー選択 → 工房クリック → `.build-option` で施設選択
3. `#resolve` → ダイス演出(Spaceでスキップ)→ `#upkeep` で次ラウンド
4. 12ラウンド回して `.panel.result` が出る → `#restart`

## 落とし穴
- HUDを `innerHTML` で全再構築するとクリック途中のボタンが消えて
  クリックが不発になる(過去に実バグ)。ホバー更新は `updatePanelOnly()`。
- favicon の404がconsoleに出るが無害。

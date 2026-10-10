# HANDOFF — ともしび くずし(2026-10-10 時点)

新しいセッションはこのファイル → `CLAUDE.md`(構成・検証コマンド・実測値)→ `design/fun.md`(面白さの設計)の順に読めば再開できる。

## 現状
- **M0 アルファ公開済み**: https://tomoshibi-kuzushi.vercel.app
  - GitHub: 公開repo acglay/tomoshibi-kuzushi(main)
  - Vercel: Git連携済み(pushで本番に自動デプロイ)
  - hub: `hub/lib/apps.ts` にカード追加済み(🧱・tags sandbox・added 2026-10-09)、`register-version.mjs --latest` も登録済み
- 中身: ボールが光源の暗闇ブロック崩し(2D Radiance Cascades。RCは tomoshibi-yoko から流用)。
  - 壊れたブロックから光の粒が落ちる → パドルで受けて🔆ゲージをためる → 満タンで放つ
  - 🔆はボールの位置で大閃光。RCの明るさを読み戻した値×時間で、光が届いたブロックだけ焼け落ちる(影の中は残る)
  - 🏮灯籠ブロックは壊すと燃えて隣を焼く。💠玉ブロックはボール+2
- 数値の検証はすべてOK(`scripts/check.mjs` a〜d とsmokeのbaseline)。値は CLAUDE.md の「2026-10-09 実測」にある。
- **パパの試遊はまだ**。感想が来たら `design/fun.md` §6 に記録してから調整する。

## 試遊で見てもらう点 / 調整のつまみ(全部 `lib/tuning.ts`)
| 見る点 | つまみ | 今の値 |
|---|---|---|
| 🔆がどれだけ焼けるか(今は約100px) | `BURST_E` `BURST_T` `HEAT_MIN_LUM` `HEAT_TO_BREAK` | 260 / 0.9s / 0.6 / 0.3 |
| 暗さ・探る楽しさ(ボールで見える範囲は約95px) | `BALL_E` `SEEN_LUM` `SEEN_MEMORY` `LANTERN_E` `NEON_E` | 16 / 0.08 / 6s / 0.6 / 0.22 |
| 粒の取りこぼし(ボットでも受けた数≒落とした数) | `GAUGE_MAX` `GRAIN_G` `GRAIN_POP_V` `PADDLE_HX` | 16 / 420 / 120 / 34 |
| スマホのドラッグ感度・🔆ボタンの位置 | `app/page.tsx` の `* 1.25`、`globals.css` の `.burst` | — |
- 閾値を変えたら `node scripts/check.mjs` の (a) を必ず再実行する。明るさの単位は実測で較正してある(🔆はE260で100px先が2.1、ボールは30px先が0.55)。

## 残タスク(M0の外。優先度順の候補)
1. パパ試遊のフィードバック反映(今・大きく・小さく の3案で比べる。APP-STANDARDS §5b)
2. 効果音(焼け落ちる音の連なり=🔆の快感を強める)
3. fun.md §5 の未決定案: 🔆をパドルから撃ち上げる光の玉にする/盤面に鏡・プリズム
4. ステージ選択・コントローラー対応

## 運用の要点(ハマりどころ)
- 検証サーバーは **ポート3394**(3393/3395は別アプリ)。`npx next start -p 3394`。**再buildの前にサーバーを止める**(止めないと古いチャンクが404になる)。
- 回帰の確認: `node Z:/Claude/_tools/smoke.mjs --app tomoshibi-kuzushi "http://localhost:3394/#seed=7&tier=3&play" --settle 3000`。
  - HUDのcanvasは透明の重ねなので、HUDが盤面の外を暗く塗る処理を消すと「描画されてない疑い」でNGになる。
- テストは `g.paused=true` にして `g.tick(dt)` で進める(描画と読み戻しは止まらない)。オートパドルは `#bot&speed=N`。
- **hubリポジトリはブランチがmaster**。他セッションも触るので、編集直前にpullし、`lib/apps.ts` だけを明示パスでaddする(`git add -A` は禁止)。
- **auto modeの罠**: 依頼が会話外の通知で届いたセッションでは、`gh repo create --public` と `vercel deploy --prod` が分類器に拒否された。
  - `vercel link` はGitHub連携を自動で付けるので、その後のpushだけで本番デプロイが走る。
  - 公開系の操作はユーザーの承認を取ってから行う(今回は 2026-10-09 に「公開してよい」をもらった)。
- 変更の流れ: 変更 → `npm run build` / `npm run lint` → check.mjs と smoke → commit+push(これで自動デプロイ)。新しい版を凍結するときは `register-version.mjs` も実行する。

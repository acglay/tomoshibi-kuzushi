@AGENTS.md

再開時はまず [HANDOFF.md](HANDOFF.md)(現状・残タスク・ハマりどころ)を読む。

# tomoshibi-kuzushi — ともしび くずし

暗闇のブロック崩し。光の計算は2D Radiance Cascades(RC、ともしびシリーズ共通)。**ボールが光源**で、ブロックは照らされるまで見えない。面白さの設計は `design/fun.md`、数値は全部 `lib/tuning.ts`(ロジックに直書きしない)。

## 要件(M0 アルファ)
- 盤面はseedから生成(12列、左右対称。ステージごとに 散らし/ひし形/柱/市松 の4型が回る)。ブロック: ふつう/かたい(2回)/🏮灯籠(かすかに灯る・壊すと燃えて隣を焼く+粒7個)/💠玉(ボール+2)
- ブロックはRCの遮蔽物(影を落とす)。**見えた判定はRCの明るさのGPU読み戻し**(各ブロックの4面のすぐ外、`RIM_OUT`)。`SEEN_LUM`超えで輪郭が `SEEN_MEMORY` 秒残る
- 壊れたブロックから光の粒が落ち、パドルで受けると🔆ゲージ。満タンで放つと**最も上のボールの位置で大閃光**、読み戻した明るさ×時間(`HEAT_*`)で焼け落ちる=影の中のブロックは残る。灯籠の炎も同じ経路で隣を焼く
- 操作: PC=マウスでパドル・クリックで打つ・右クリック/Spaceで🔆・←→。スマホ=横ドラッグ(相対、1.25倍)・タップで打つ・🔆ボタン
- ハイスコアを localStorage(`tomoshibi-kuzushi-best-v1`)+hub(`best`)に保存。未ログインで完全動作、🏠はhubトークンがある時だけ

## 構成
- `lib/rc.ts` — RCレンダラ(tomoshibi-yokoからコピー)。こちらでの変更は2点: ①読み戻し本数 `PROBE_N`=1024(ブロック×4面) ②箱スプライト(mode1・shape=1)は**面のすぐ外の明るさ**で塗る(上下面を高さで、左右面を端の近くだけ混ぜる。箱自体が遮蔽物で中の光は0のため)
- `lib/game.ts` — 盤面生成・ボール(サブステップ `BALL_SUBSTEP` px ごとに円×箱の押し出し+反射)・粒とゲージ・🔆・描画バッチ・読み戻し(`applyLum`)・オートパドルのボット(`bot`)。デバッグ: `noBreak` `floorBounce` `timeScale`
- `lib/perf.ts`(画質自動・無改造)/ `lib/hub-client.ts`(APP_ID=tomoshibi-kuzushi)
- `app/page.tsx` — ループ・入力・HUD(2D canvas重ね: ステージ・スコア・♥・🔆ゲージ)・⚙(画質 自動/5段階+診断)・📷

## Build, Test & Verify
- `npm run build` / `npm run lint`(コミット前にgreen)。検証サーバーは `npx next start -p 3394` を1本だけ(3393/3395は別アプリが使う)。**再buildの前にサーバーを止める**(残すと古いチャンクが404)
- 数値の検証: `node scripts/check.mjs`(`--skip-bot` でdを省略、全部で約2分)
  - (a) 最下段のブロックの真下にボールを止めて距離330/120/25px → lum・lightAt(別経路で同値か)・見えた判定。🔆を真下で放って段ごとの残り数。**影のA/B**: 同じ🔆で、間にブロック1個あり/なしの焼け方
  - (b) 10球×6000フレーム(壊れない/壊れる)で、めり込み0.6px超・場外・ほぼ水平の回数
  - (c) tier=3固定でボール1個⇔30個を交互に3回ずつGPU時間
  - (d) ボット(speed=3・tier=2)でseed 11/22/33のステージ1クリア時間・ライフ損失・🔆回数・焼けた数・残り数の推移(上/中/下の段)
- 2026-10-09 実測(RTX2070・灯籠E0.6/ネオン0.22の最終値): (a) 330px lum0.007・120px 0.051=不可視/25px 0.575=可視、lightAtと一致。開始時に見えているのは76個中8個(灯籠のまわり)。🔆で21個焼け上3段は無傷。影A/B: 遮りなし lum最大3.39で4hp/陰 0.65で0hp (b) めり込み0・場外0・水平0(最大0.21px。breakingはステージを壊し切って次へ進むので終了時1球) (c) 1個2.01ms ⇔ 30個2.17ms(光源7→36、+8%) (d) クリア75/120/75秒・ライフ損失0・🔆1〜2回・焼けた19〜37個・粒は受けた23〜48/落とした47〜49
- 回帰: `node Z:/Claude/_tools/smoke.mjs --app tomoshibi-kuzushi "http://localhost:3394/#seed=7&tier=3&play" --settle 3000`(baseline登録済み)
- 見た目(人用): `WAIT=9000 node scripts/shot.mjs "seed=22&bot&speed=2&tier=3"` → `.shots/`
- **ヘッドレスChromiumは既定でSwiftShader(CPU)**。速度を測るときは `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`(スクリプトは指定済み)
- 数値API: `window.game.stats()` / `window.game.lightAt([[x,y],...])` / `window.game.g`(Game本体)。テストは `g.paused=true` にして `g.tick(dt)` で進める(描画と読み戻しは止まらない)
- URL: `#seed=N` `#play` `#tier=N` `#bot&speed=N`(オートパドル)

## 運用
- APP_ID = tomoshibi-kuzushi。localStorageキーは `tomoshibi-kuzushi-<用途>-v1`(best・settings・perf)
- `preserveDrawingBuffer` はPCでオン(smokeと📷のため)、スマホはオフ。スマホは毎フレーム `gl.finish()`、低い2段はバイリニア修正オフ
- 区切りごとにcommit+push。公開したら `hub/scripts/register-version.mjs` まで。公開: https://tomoshibi-kuzushi.vercel.app(公開repo acglay/tomoshibi-kuzushi・GitHub連携=pushで自動デプロイ・hub登録済み 2026-10-09)

## 未実装(M0の外)
- 効果音・BGM/ステージ選択/コントローラー/盤面の鏡・プリズム(fun.md §5)

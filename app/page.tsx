"use client";

import { useEffect, useRef, useState } from "react";
import { Game, FX0, FX1 } from "@/lib/game";
import { RC } from "@/lib/rc";
import { T } from "@/lib/tuning";
import { AutoPerf, TIERS, guessTier, isMobile } from "@/lib/perf";
import { captureHubToken, hubToken, hubLoad, hubSave, HUB_URL } from "@/lib/hub-client";

const BEST_KEY = "tomoshibi-kuzushi-best-v1";
const SET_KEY = "tomoshibi-kuzushi-settings-v1";
const PERF_KEY = "tomoshibi-kuzushi-perf-v1";
const DEF = { perf: -1 }; // -1 = auto, 0..4 = fixed tier

type Toast = { id: number; text: string; color: string };

export default function Page() {
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [settings, setSettings] = useState({ ...DEF });
  const [panel, setPanel] = useState(false);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState<null | { stage: number; score: number }>(null);
  const [err, setErr] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hub, setHub] = useState(false);
  const [best, setBest] = useState(0);
  const [touch, setTouch] = useState(false);
  const [full, setFull] = useState(false);
  const shotRef = useRef(false);
  const applyTierRef = useRef<((p: number) => void) | null>(null);
  const [tierView, setTierView] = useState<{ tier: number; gpu: number; diag?: string }>({ tier: 3, gpu: -1 });
  const [hint, setHint] = useState(0);

  const toast = (text: string, color = "#eee") => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, color }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  };

  useEffect(() => {
    captureHubToken();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHub(!!hubToken());
    setTouch(matchMedia("(pointer: coarse)").matches);
    let savedPerf = -1;
    try {
      const s = JSON.parse(localStorage.getItem(SET_KEY) || "null");
      if (s) { setSettings((o) => ({ ...o, ...s })); savedPerf = Number(s.perf ?? -1); }
    } catch {}
    const b = Number(localStorage.getItem(BEST_KEY) || 0);
    setBest(b);
    hubLoad("best").then((r) => {
      const v = Number(r?.value || 0);
      if (v > b) {
        localStorage.setItem(BEST_KEY, String(v));
        setBest(v);
      }
    });

    const hash = new URLSearchParams(location.hash.slice(1));
    const seed = Number(hash.get("seed")) || Math.floor(Math.random() * 1e9);
    const canvas = glRef.current!;
    const hud = hudRef.current!;
    let rc: RC;
    try {
      rc = new RC(canvas, !isMobile(""));
      rc.finishEachFrame = isMobile(rc.renderer);
      if (!rc.ok) setErr(rc.err);
    } catch (e) {
      setErr(String(e));
      return;
    }
    let saved: { renderer?: string; tier?: number } = {};
    try { saved = JSON.parse(localStorage.getItem(PERF_KEY) || "{}"); } catch {}
    const forced = hash.has("tier") ? Number(hash.get("tier")) : -1;
    const start = saved.renderer === rc.renderer && saved.tier !== undefined ? saved.tier : guessTier(rc.renderer);
    const auto = new AutoPerf(start, rc.hasTimer);
    let dprCap = 2;
    let manual = forced >= 0 ? forced : savedPerf;
    let curTier = -1;
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    let hudDpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      cw = Math.round(canvas.clientWidth * dpr);
      ch = Math.round(canvas.clientHeight * dpr);
      canvas.width = cw;
      canvas.height = ch;
      hudDpr = Math.min(window.devicePixelRatio || 1, 2);
      hud.width = Math.round(canvas.clientWidth * hudDpr);
      hud.height = Math.round(canvas.clientHeight * hudDpr);
    };
    const applyTier = (t: number) => {
      t = Math.max(0, Math.min(TIERS.length - 1, t));
      if (t === curTier) return;
      curTier = t;
      rc.rcScale = TIERS[t].rc;
      rc.bilinearFix = TIERS[t].fix;
      dprCap = TIERS[t].dpr;
      resize();
    };
    applyTierRef.current = (p: number) => {
      manual = forced >= 0 ? forced : p;
      applyTier(manual >= 0 ? manual : auto.tier);
    };
    rc.baseInterval = T.RC_BASE_INTERVAL;
    const g = new Game(seed);
    gameRef.current = g;
    g.onToast = (t, c) => toast(t, c);
    g.onStage = (s) => { if (s > 1) toast(`ステージ ${s}`, "#c79bff"); };
    if (hash.has("bot")) { g.bot = true; g.timeScale = Number(hash.get("speed")) || 1; }
    if (hash.has("play") || g.bot) setStarted(true);
    applyTier(manual >= 0 ? manual : auto.tier);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // world px per css px (the whole field fits the screen)
    const fitWpp = () => Math.max((T.MAP_W * T.TILE) / cw, (T.MAP_H * T.TILE) / ch);
    const toWorldX = (clientX: number) => (T.MAP_W * T.TILE) / 2 + (clientX - canvas.clientWidth / 2) * fitWpp() * dpr;
    const keys = new Set<string>();
    const updKeys = () => {
      g.input.mx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      if (g.input.mx !== 0) g.input.targetX = null;
    };
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (g.balls.some((b) => b.stuck)) g.input.launch = true;
        else g.input.burst = true;
      }
      if (e.code === "Escape") g.paused = !g.paused;
      keys.add(e.code);
      updKeys();
    };
    const ku = (e: KeyboardEvent) => {
      keys.delete(e.code);
      updKeys();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    // mouse: the paddle follows the pointer. touch: drag anywhere = relative move, a short tap = launch
    let drag: { id: number; x0: number; p0: number; moved: number; t0: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        setTouch(true);
        if (!drag) drag = { id: e.pointerId, x0: e.clientX, p0: g.paddleX, moved: 0, t0: performance.now() };
        return;
      }
      if (e.button === 0) g.input.launch = true;
      if (e.button === 2) g.input.burst = true;
    };
    const onMove = (e: PointerEvent) => {
      if (g.bot) return;
      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x0;
        drag.moved = Math.max(drag.moved, Math.abs(dx));
        g.input.targetX = drag.p0 + dx * fitWpp() * dpr * 1.25;
        return;
      }
      if (e.pointerType !== "touch") g.input.targetX = toWorldX(e.clientX);
    };
    const onUp = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        if (drag.moved < 10 && performance.now() - drag.t0 < 350) g.input.launch = true;
        drag = null;
      }
    };
    hud.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    const noCtx = (e: Event) => e.preventDefault();
    hud.addEventListener("contextmenu", noCtx);
    const blur = () => { keys.clear(); updKeys(); };
    window.addEventListener("blur", blur);

    let last = performance.now();
    let fps = 60;
    let raf = 0;
    let wasOver = false;
    let hintSeen = 0;
    let fullSeen = false;
    const diag = { cpu: -1, submit: -1, hud: -1 };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
      if (manual < 0) {
        const was = auto.phase;
        const nt = auto.tick(dt * 1000, rc.gpuMs, rc.gpuSerial, !g.paused && !g.over && document.visibilityState === "visible");
        if (nt !== null) {
          applyTier(nt);
          if (was === "run") toast(`重かったので画質を「${TIERS[nt].name}」に下げました`, "#9fb");
        }
        if ((was === "calib" && auto.phase === "run") || (nt !== null && was === "run")) localStorage.setItem(PERF_KEY, JSON.stringify({ renderer: rc.renderer, tier: auto.tier }));
      }
      if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500))
        setTierView({ tier: curTier, gpu: rc.gpuMs, diag: `${Math.round(fps)}fps ・ 計算${diag.cpu.toFixed(1)} 描画${diag.submit.toFixed(1)}${rc.finishEachFrame ? "(待ち込)" : ""} HUD${diag.hud.toFixed(1)}ms ・ ${cw}×${ch} RC${rc.W}×${rc.H} ・ ${rc.renderer.replace(/^ANGLE \(|\)$/g, "").slice(0, 60)}` });
      // hints: launch -> catch grains -> release 🔆
      const h = hintSeen === 0 && g.balls.some((b) => !b.stuck) ? 1 : hintSeen === 1 && g.gauge >= T.GAUGE_MAX ? 2 : hintSeen === 2 && g.counters.bursts > 0 ? 3 : hintSeen;
      if (h !== hintSeen) { hintSeen = h; setHint(h); }
      const f0 = g.gauge >= T.GAUGE_MAX;
      if (f0 !== fullSeen) { fullSeen = f0; setFull(f0); }
      const c0 = performance.now();
      g.update(dt);
      if (g.over && !wasOver) {
        wasOver = true;
        setOver({ stage: g.stage, score: g.score });
        const b = Number(localStorage.getItem(BEST_KEY) || 0);
        if (g.score > b) {
          localStorage.setItem(BEST_KEY, String(g.score));
          setBest(g.score);
          hubSave("best", g.score);
        }
      }
      if (!g.over) wasOver = false;
      const wpp = fitWpp();
      const f = g.frame(cw, ch, wpp);
      rc.serial = g.probeSerial;
      const prevSerial = rc.lumSerial;
      const c1 = performance.now();
      rc.render(f);
      const c2 = performance.now();
      if (rc.lumSerial !== prevSerial) g.applyLum(rc.lumSerial, rc.lum, rc.lumReady);
      drawHud(hud, g, { camX: f.camX, camY: f.camY, wpp: (wpp * dpr) / hudDpr }, hudDpr);
      const c3 = performance.now();
      const ema = (a: number, b: number) => (a < 0 ? b : a * 0.93 + b * 0.07);
      diag.cpu = ema(diag.cpu, c1 - c0);
      diag.submit = ema(diag.submit, c2 - c1);
      diag.hud = ema(diag.hud, c3 - c2);
      if (shotRef.current) {
        shotRef.current = false;
        const c = document.createElement("canvas");
        c.width = hud.width;
        c.height = hud.height;
        const x = c.getContext("2d")!;
        x.drawImage(canvas, 0, 0, hud.width, hud.height);
        x.drawImage(hud, 0, 0);
        const a = document.createElement("a");
        a.href = c.toDataURL("image/png");
        a.download = `tomoshibi-kuzushi-${g.seed}-s${g.stage}.png`;
        a.click();
      }
    };
    raf = requestAnimationFrame(loop);

    (window as unknown as { game: unknown }).game = {
      g,
      rc,
      stats: () => ({
        fps: Math.round(fps),
        lights: g.lightCount,
        stage: g.stage,
        score: g.score,
        lives: g.lives,
        blocks: g.blocks.length,
        seen: g.blocks.filter((k) => k.seen > 0).length,
        balls: g.balls.length,
        grains: g.gn,
        gauge: g.gauge,
        time: Math.round(g.time * 10) / 10,
        counters: g.counters,
        rc: { W: rc.W, H: rc.H, cascades: rc.cascades, scale: rc.rcScale, fix: rc.bilinearFix },
        diag: { ...diag },
        perf: { tier: curTier, name: TIERS[curTier]?.name, auto: manual < 0, phase: auto.phase, gpuMs: Math.round(rc.gpuMs * 100) / 100, gpuSerial: rc.gpuSerial, hasTimer: rc.hasTimer, renderer: rc.renderer, canvas: [cw, ch], log: auto.log },
      }),
      lightAt: (pts: number[][], which: "view" | "game" = "view") => rc.measureSync(pts, which),
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SET_KEY, JSON.stringify(settings));
    applyTierRef.current?.(settings.perf);
  }, [settings]);

  useEffect(() => {
    if (gameRef.current) gameRef.current.paused = !started;
  }, [started]);

  const retry = () => {
    const old = gameRef.current!;
    const g = new Game(Math.floor(Math.random() * 1e9));
    g.onToast = old.onToast;
    g.onStage = old.onStage;
    g.input = old.input;
    Object.assign(old, g);
    setOver(null);
  };

  const burst = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (gameRef.current) gameRef.current.input.burst = true;
  };

  return (
    <main className="root">
      <canvas ref={glRef} className="layer" />
      <canvas ref={hudRef} className="layer hud" />
      <div className="topbar">
        {hub && <a className="rb" href={HUB_URL} title="ホームへ">🏠</a>}
        <button className="rb" title="スクショ保存" onClick={() => (shotRef.current = true)}>📷</button>
        <button className="rb" title="設定" onClick={() => setPanel((p) => !p)}>⚙</button>
      </div>
      {panel && (
        <div className="panel">
          <div className="ptitle">設定</div>
          <div className="ptitle2">画質 <span className="pnow">いま: {TIERS[tierView.tier]?.name}{tierView.gpu >= 0 ? ` (GPU ${tierView.gpu.toFixed(1)}ms)` : ""}</span></div>
          <div className="views">
            <button className={settings.perf < 0 ? "on" : ""} onClick={() => setSettings((s) => ({ ...s, perf: -1 }))}>自動</button>
            {TIERS.map((t, i) => (
              <button key={t.name} className={settings.perf === i ? "on" : ""} onClick={() => setSettings((s) => ({ ...s, perf: i }))}>{t.name}</button>
            ))}
          </div>
          <div className="diag">診断: {tierView.diag}</div>
          <p className="note">ひかりの計算: Radiance Cascades。ボールが何個にふえても計算量はほぼ一定。</p>
        </div>
      )}
      {started && !over && (
        <button className={`burst ${full ? "full" : ""}`} onPointerDown={burst} title="🔆 はなつ(右クリック / Space)">🔆</button>
      )}
      {started && !over && hint < 3 && (
        <div className="hint">
          {hint === 0 && (touch ? "横にドラッグでパドル・タップでボールを打つ" : "マウスでパドル・クリックでボールを打つ")}
          {hint === 1 && "こわれたブロックから落ちる 光の粒を パドルで受けよう"}
          {hint === 2 && (touch ? "🔆 をおすと ボールの場所で大きく光る。光がとどいたブロックが焼ける" : "🔆(右クリック / Space)で ボールの場所が大きく光る。光がとどいたブロックが焼ける")}
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast" style={{ color: t.color }}>{t.text}</div>
        ))}
      </div>
      {!started && !err && (
        <div className="overlay">
          <h1>ともしび くずし</h1>
          <p className="sub">ボールは光。照らさないと ブロックは見えない。</p>
          <ul>
            <li>💡 ボールのまわりだけ明るい。暗やみのブロックを 光でさがして くずす</li>
            <li>✨ こわれたブロックから 光の粒が落ちる。パドルで受けて 🔆 をためる</li>
            <li>🔆 たまったら はなつ。ボールの場所で大きく光り、<b>光がとどいたブロックが焼け落ちる</b>(かげの中は残る)</li>
            <li>🏮 灯籠ブロックは かすかに光る。こわすと まわりが燃える</li>
            <li>💠 玉ブロックで ボール(=光)がふえる</li>
          </ul>
          <p className="keys">PC: マウスでパドル / クリック 打つ / 右クリック・Space 🔆 / ←→ でも動く<br />スマホ: 横にドラッグでパドル / タップで打つ / 🔆 ボタン</p>
          {best > 0 && <p className="best">ハイスコア: {best}</p>}
          <button className="go" onClick={() => setStarted(true)}>はじめる</button>
        </div>
      )}
      {over && (
        <div className="overlay">
          <h1>ひかりが きえた…</h1>
          <p className="sub">ステージ {over.stage} / スコア {over.score}</p>
          {best > 0 && <p className="best">ハイスコア: {best}</p>}
          <button className="go" onClick={retry}>もう一度</button>
        </div>
      )}
      {err && <div className="overlay"><h1>うごきません</h1><p>{err}</p></div>}
    </main>
  );
}

function drawHud(c: HTMLCanvasElement, g: Game, cam: { camX: number; camY: number; wpp: number }, dpr: number) {
  const x = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  x.clearRect(0, 0, W, H);
  const u = dpr;
  const sx = (wx: number) => (wx - cam.camX) / cam.wpp;
  const sy = (wy: number) => (wy - cam.camY) / cam.wpp;
  const left = sx(FX0);
  const right = sx(FX1);
  const fieldW = right - left;
  // dim the rock outside the map so the field stands out (also keeps this overlay from reading as blank in smoke)
  {
    const mx0 = sx(0), mx1 = sx(T.MAP_W * T.TILE), my0 = sy(0), my1 = sy(T.MAP_H * T.TILE);
    x.fillStyle = "rgba(0,0,0,0.6)";
    x.fillRect(0, 0, Math.max(0, mx0), H);
    x.fillRect(mx1, 0, Math.max(0, W - mx1), H);
    x.fillRect(mx0, 0, mx1 - mx0, Math.max(0, my0));
    x.fillRect(mx0, my1, mx1 - mx0, Math.max(0, H - my1));
  }
  // top line inside the field: stage, score, lives
  x.textAlign = "left";
  x.font = `bold ${13 * u}px sans-serif`;
  x.fillStyle = "#d9c7a0";
  x.fillText(`ステージ ${g.stage}   スコア ${g.score}`, left + 6 * u, sy(T.TILE) + 18 * u);
  x.textAlign = "right";
  x.fillStyle = "#ff8a8a";
  x.fillText("♥".repeat(Math.max(0, g.lives)), right - 6 * u, sy(T.TILE) + 18 * u);
  // 🔆 gauge under the paddle
  const gy = sy(T.PADDLE_Y) + 22 * u;
  const gw = Math.min(fieldW - 20 * u, 260 * u);
  const gx = (left + right) / 2 - gw / 2;
  const k = g.gauge / T.GAUGE_MAX;
  x.fillStyle = "rgba(0,0,0,0.5)";
  x.fillRect(gx, gy, gw, 7 * u);
  x.fillStyle = k >= 1 ? `rgba(255,${200 + 55 * Math.sin(g.time * 8)},120,1)` : "#c8913e";
  x.fillRect(gx, gy, gw * k, 7 * u);
  x.textAlign = "center";
  x.font = `${10 * u}px sans-serif`;
  x.fillStyle = k >= 1 ? "#ffe2a0" : "#9a8f80";
  x.fillText(k >= 1 ? "🔆 はなてる!" : `🔆 ${g.gauge}/${T.GAUGE_MAX}`, (left + right) / 2, gy + 20 * u);
  if (g.clearT > 0) {
    x.font = `bold ${24 * u}px sans-serif`;
    x.fillStyle = "#ffd890";
    x.fillText(`ステージ ${g.stage} クリア!`, (left + right) / 2, H * 0.45);
  }
  if (g.paused && !g.over) {
    x.fillStyle = "rgba(0,0,0,0.35)";
    x.fillRect(0, 0, W, H);
  }
}

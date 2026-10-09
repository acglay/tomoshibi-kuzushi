// Numeric checks for the M0: node scripts/check.mjs [url] [--skip-bot]
// (a) a dark block far from the ball is not seen; bring the ball near and it is (RC readback, cross-checked with lightAt)
//     + the 🔆 burns exposed blocks and leaves the ones in their shadow
// (b) collision soak: thousands of frames, no ball inside a block or outside the field
// (c) 1 ball vs 30 balls: GPU time per frame (tier=3 fixed, alternating 3 times each)
// (d) auto-paddle bot on 3 seeds: time to clear stage 1, lives lost, blocks left over time by row band
import { chromium } from "file:///Z:/Claude/_tools/node_modules/playwright/index.mjs";

const url = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3394";
const skipBot = process.argv.includes("--skip-bot");
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ args: GPU });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url + "/#seed=7&play&tier=3");
await page.waitForTimeout(2000);

const out = await page.evaluate(async () => {
  const G = window.game;
  const g = G.g;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const res = {};
  const T = { R: 4.5, HX: 14.5, HY: 6, FX0: 16, FX1: 400, FY0: 16 };
  g.paused = true; // the live loop keeps rendering (and reading light back) but stops stepping; tests step with g.tick()

  // (a) seeing: a normal block on the lowest row, ball straight below it
  {
    const low = Math.max(...g.blocks.map((k) => k.y));
    const k = g.blocks.filter((q) => q.y === low && q.kind === 0).sort((a, b) => Math.abs(a.x - 208) - Math.abs(b.x - 208))[0];
    const face = () => [[k.x, k.y - T.HY - 2], [k.x, k.y + T.HY + 2], [k.x - T.HX - 2, k.y], [k.x + T.HX + 2, k.y]];
    const at = async (d) => {
      g.balls = [{ x: k.x, y: k.y + T.HY + d, vx: 0, vy: 0, stuck: false }];
      g.flashes = [];
      for (const q of g.blocks) q.seen = 0;
      await sleep(200);
      g.tick(1 / 120);
      return { dist: d, lum: r3(k.lum), lightAtMax: r3(Math.max(...G.lightAt(face()))), seen: k.seen > 0, seenBlocks: g.blocks.filter((q) => q.seen > 0).length, total: g.blocks.length };
    };
    res.a = { far: await at(330), mid: await at(120), near: await at(25), seenLum: 0.08 };
    // 🔆 from below the middle of the lowest row: exposed blocks burn, blocks behind them (higher rows, same column) do not
    const before = new Set(g.blocks.map((q) => q.id));
    const rows = Math.max(...g.blocks.map((q) => q.r));
    g.balls = [{ x: k.x, y: k.y + T.HY + 40, vx: 0, vy: 0, stuck: false }];
    g.gauge = 16;
    g.input.burst = true;
    for (let i = 0; i < 150; i++) { g.tick(1 / 120); await new Promise((r) => requestAnimationFrame(r)); }
    const gone = [...before].filter((id) => !g.blocks.some((q) => q.id === id)).length;
    const leftByRow = Array.from({ length: rows + 1 }, (_, r) => g.blocks.filter((q) => q.r === r).length);
    res.a.burst = { burned: g.counters.burned, gone, blocksLeft: g.blocks.length, leftByRow, topRowsUntouched: leftByRow.slice(0, 3).join(",") };
    // shadow A/B: the same 🔆 under a target block, with and without one block between them
    const ab = async (withBlocker) => {
      g.newStage(1);
      const tgt = g.blocks.find((q) => q.r === 2 && q.c === 5) || g.blocks[0];
      const blk = g.blocks.find((q) => q.r === 4 && q.c === 5);
      const keep = new Set([tgt, withBlocker ? blk : null].filter(Boolean));
      for (const q of g.blocks) if (!keep.has(q)) g.grid[q.r * 12 + q.c] = null;
      g.blocks = g.blocks.filter((q) => keep.has(q));
      tgt.kind = 0; tgt.hp = 9; tgt.heat = 0;
      if (blk) { blk.kind = 0; blk.hp = 99; }
      g.balls = [{ x: tgt.x, y: tgt.y + 80, vx: 0, vy: 0, stuck: false }];
      await sleep(200);
      g.gauge = 16; g.input.burst = true;
      let lumMax = 0;
      for (let i = 0; i < 150; i++) { g.tick(1 / 120); await new Promise((r) => requestAnimationFrame(r)); lumMax = Math.max(lumMax, tgt.lum); }
      return { lumMax: Math.round(lumMax * 100) / 100, hpLost: 9 - tgt.hp };
    };
    res.a.shadowAB = { open: await ab(false), behindBlock: await ab(true) };
  }

  // (b) collision soak (pure logic): 10 balls, blocks never break / the pit bounces, then the same with breaking on
  const soak = (frames, noBreak) => {
    g.newStage(1);
    g.noBreak = noBreak;
    g.floorBounce = true;
    g.balls = [];
    for (let i = 0; i < 10; i++) g.addBall(60 + i * 30, 420, (i / 9 - 0.5) * 2);
    let inside = 0, out = 0, maxPen = 0, flat = 0, hits0 = g.counters.hits;
    for (let f = 0; f < frames; f++) {
      g.tick(1 / 60);
      for (const b of g.balls) {
        if (b.x < T.FX0 + T.R - 0.01 || b.x > T.FX1 - T.R + 0.01 || b.y < T.FY0 + T.R - 0.01) out++;
        if (Math.abs(b.vy) < 0.27 * Math.hypot(b.vx, b.vy)) flat++;
        for (const k of g.blocks) {
          const qx = Math.max(-T.HX, Math.min(T.HX, b.x - k.x)), qy = Math.max(-T.HY, Math.min(T.HY, b.y - k.y));
          const d = Math.hypot(b.x - k.x - qx, b.y - k.y - qy);
          const pen = (b.x === k.x + qx && b.y === k.y + qy) ? T.R + 1 : T.R - d;
          if (pen > 0.6) inside++;
          maxPen = Math.max(maxPen, pen);
        }
      }
    }
    return { frames, balls: g.balls.length, ballFrames: frames * g.balls.length, inside, outOfField: out, flat, maxPenetration: r3(maxPen), hits: g.counters.hits - hits0, blocksLeft: g.blocks.length };
  };
  res.b = { solid: soak(6000, true), breaking: soak(6000, false) };
  g.noBreak = false;
  g.floorBounce = false;

  // (c) GPU time: 1 ball vs 30 balls (static, spread over the field), alternating
  {
    g.newStage(1);
    const one = () => { g.balls = [{ x: 208, y: 400, vx: 0, vy: 0, stuck: false }]; };
    const many = () => { g.balls = []; for (let i = 0; i < 30; i++) g.balls.push({ x: 40 + (i % 10) * 37, y: 300 + Math.floor(i / 10) * 90, vx: 0, vy: 0, stuck: false }); };
    const measure = async () => {
      await sleep(400);
      const s = [];
      let last = G.rc.gpuSerial;
      const t0 = performance.now();
      while (s.length < 40 && performance.now() - t0 < 4000) {
        await new Promise((r) => requestAnimationFrame(r));
        if (G.rc.gpuSerial !== last) { last = G.rc.gpuSerial; s.push(G.rc.gpuMs); }
      }
      return Math.round(med(s) * 100) / 100;
    };
    const r = { one: [], thirty: [], lights: [] };
    for (let i = 0; i < 3; i++) {
      one(); r.one.push(await measure()); const l1 = G.stats().lights;
      many(); r.thirty.push(await measure()); r.lights.push([l1, G.stats().lights]);
    }
    r.tier = G.stats().perf.name;
    res.c = r;
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));

// (d) bot: separate pages, sped up (lum readback lags 1-2 rendered frames, so keep the speed modest)
if (!skipBot) {
  const SPEED = 3, CAP = 300;
  const runs = await Promise.all([11, 22, 33].map(async (seed) => {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${url}/#seed=${seed}&bot&speed=${SPEED}&tier=2`);
    await p.waitForTimeout(1000);
    const total = await p.evaluate(() => window.game.g.blocks.length);
    const timeline = [];
    let st;
    for (;;) {
      await p.waitForTimeout(1000);
      st = await p.evaluate(() => {
        const g = window.game.g;
        const band = [0, 0, 0];
        for (const k of g.blocks) band[Math.min(2, Math.floor((k.r / g.rows) * 3))]++;
        return { t: Math.round(g.stageT), stage: g.stage, blocks: g.blocks.length, band: band.join("/"), lives: g.lives, over: g.over, everSeen: g.blocks.filter((k) => k.everSeen).length, c: g.counters, fps: window.game.stats().fps };
      });
      if (timeline.length === 0 || st.t >= timeline[timeline.length - 1].t + 20) timeline.push({ t: st.t, left: st.blocks, band: st.band });
      if (st.c.clears.length || st.over || st.t > CAP) break;
    }
    await ctx.close();
    return { seed, total, cleared: st.c.clears[0] ?? null, over: st.over, livesLost: st.c.lost, bursts: st.c.bursts, burned: st.c.burned, hits: st.c.hits, caught: st.c.caught, dropped: st.c.dropped, left: st.blocks, fps: st.fps, timeline: timeline.map((x) => `${x.t}s:${x.left}(${x.band})`).join(" ") };
  }));
  console.log(JSON.stringify({ d: { speed: SPEED, capS: CAP, runs } }, null, 1));
}
console.log("errors:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();

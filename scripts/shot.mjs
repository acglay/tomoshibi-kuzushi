// human-eye screenshots: node scripts/shot.mjs [hash...] -> .shots/
import { chromium } from "file:///Z:/Claude/_tools/node_modules/playwright/index.mjs";
const url = process.env.URL || "http://localhost:3394";
const hashes = process.argv.slice(2).length ? process.argv.slice(2) : ["seed=7&play&tier=3"];
const b = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on("pageerror", (e) => console.log("pageerror", String(e)));
for (const [i, h] of hashes.entries()) {
  await p.goto(`${url}/#${h}`);
  await p.reload();
  await p.waitForTimeout(Number(process.env.WAIT || 2500));
  await p.screenshot({ path: `.shots/shot${i}.png` });
  console.log(`.shots/shot${i}.png`, JSON.stringify(await p.evaluate(() => { const s = window.game.stats(); return { blocks: s.blocks, seen: s.seen, balls: s.balls, gauge: s.gauge, perf: s.perf.name, gpu: s.perf.gpuMs }; })));
}
await b.close();

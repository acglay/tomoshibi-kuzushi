import { Batch, Frame, PROBE_N } from "./rc";
import { T } from "./tuning";

type V3 = [number, number, number];
export const NORMAL = 0, HARD = 1, LANTERN = 2, ORB = 3;
export type Block = { id: number; c: number; r: number; x: number; y: number; kind: number; hp: number; lum: number; seen: number; everSeen: boolean; heat: number; hitT: number; col: V3 };
export type Ball = { x: number; y: number; vx: number; vy: number; stuck: boolean };
type Flash = { x: number; y: number; r: number; e: number; c: V3; life: number; max: number; hot: boolean; follow?: Ball };

const BALL_C: V3 = [1, 0.84, 0.58];
const ORB_C: V3 = [0.45, 0.85, 1];
const FIRE: V3 = [1, 0.55, 0.22];
const NEON: V3[] = [[0.25, 0.55, 1], [1, 0.3, 0.75]];
const ROW_C: V3[] = [[0.78, 0.7, 0.6], [0.72, 0.62, 0.66], [0.62, 0.68, 0.74], [0.7, 0.74, 0.6], [0.8, 0.66, 0.52], [0.66, 0.6, 0.76]];

export const FX0 = T.TILE, FX1 = (T.MAP_W - 1) * T.TILE, FY0 = T.TILE;
export const COLS = Math.floor((FX1 - FX0) / T.CELL_W);

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let MAP_SERIAL = 0;

export class Game {
  seed: number;
  rng: () => number;
  stage = 1;
  lives = T.LIVES;
  score = 0;
  blocks: Block[] = [];
  grid: (Block | null)[] = [];
  rows = 0;
  balls: Ball[] = [];
  speed = T.BALL_V0;
  paddleX = (FX0 + FX1) / 2;
  gx = new Float32Array(T.GRAIN_MAX);
  gy = new Float32Array(T.GRAIN_MAX);
  gvx = new Float32Array(T.GRAIN_MAX);
  gvy = new Float32Array(T.GRAIN_MAX);
  gn = 0;
  gauge = 0;
  flashes: Flash[] = [];
  burstT = 0;
  time = 0;
  stageT = 0;
  paused = false;
  over = false;
  clearT = 0; // >0: stage cleared, counting down to the next
  input = { mx: 0, targetX: null as number | null, launch: false, burst: false };
  map: Uint8Array;
  mapVersion = 0;
  scene = new Batch();
  lit = new Batch();
  glow = new Batch();
  probes = new Float32Array(PROBE_N * 2);
  probeSerial = 0;
  private pendingProbe = new Map<number, number[]>();
  lightCount = 0;
  timeScale = 1;
  bot = false;
  botErr = 10; // world px of aiming noise
  noBreak = false; // debug: blocks never break (collision soak test)
  floorBounce = false; // debug: the pit bounces instead of losing the ball
  counters = { hits: 0, burned: 0, caught: 0, dropped: 0, bursts: 0, lost: 0, clears: [] as number[] };
  onToast: (t: string, c?: string) => void = () => {};
  onStage: (s: number) => void = () => {};
  private nextId = 1;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.map = new Uint8Array(T.MAP_W * T.MAP_H);
    for (let ty = 0; ty < T.MAP_H; ty++) for (let tx = 0; tx < T.MAP_W; tx++) this.map[ty * T.MAP_W + tx] = tx === 0 || tx === T.MAP_W - 1 || ty === 0 ? 1 : 0;
    this.mapVersion = ++MAP_SERIAL;
    this.newStage(1);
  }

  newStage(n: number) {
    this.stage = n;
    const R = mulberry32(this.seed * 31 + n * 7919);
    const rows = T.STAGE_ROWS[Math.min(T.STAGE_ROWS.length - 1, n - 1)];
    const pHard = T.P_HARD[Math.min(T.P_HARD.length - 1, n - 1)];
    this.rows = rows;
    this.blocks = [];
    this.grid = new Array(COLS * rows).fill(null);
    const pattern = (n - 1) % 4;
    const half = COLS / 2;
    const want = (c: number, r: number) => {
      const m = c < half ? c : COLS - 1 - c; // mirror: 0..half-1 from the wall to the middle
      if (pattern === 0) return R() < T.STAGE_FILL;
      if (pattern === 1) return m >= Math.abs(r - rows / 2) - 1; // diamond-ish
      if (pattern === 2) return m % 3 !== 2 || r === 0 || r === rows - 1; // pillars with a lid and floor
      return (m + r) % 2 === 0 || r < 2; // checker under a roof
    };
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < half; c++) if (want(c, r)) cells.push([c, r]);
    for (const [c, r] of cells) {
      const u = R();
      const kind = u < T.P_LANTERN ? LANTERN : u < T.P_LANTERN + T.P_ORB ? ORB : u < T.P_LANTERN + T.P_ORB + pHard ? HARD : NORMAL;
      for (const cc of [c, COLS - 1 - c]) this.addBlock(cc, r, kind);
    }
    // every stage has at least one lantern and one orb
    const plain = this.blocks.filter((b) => b.kind === NORMAL);
    for (const k of [LANTERN, ORB]) if (!this.blocks.some((b) => b.kind === k) && plain.length) plain.splice(Math.floor(R() * plain.length), 1)[0].kind = k;
    for (const b of this.blocks) b.hp = b.kind === HARD ? T.HARD_HP : 1;
    this.balls = [];
    this.serve();
    this.gn = 0;
    this.gauge = Math.min(this.gauge, T.GAUGE_MAX);
    this.flashes = [];
    this.burstT = 0;
    this.speed = T.BALL_V0;
    this.stageT = 0;
    this.clearT = 0;
    this.onStage(n);
  }

  private addBlock(c: number, r: number, kind: number) {
    const b: Block = {
      id: this.nextId++, c, r,
      x: FX0 + (c + 0.5) * T.CELL_W, y: T.BLOCK_TOP + (r + 0.5) * T.CELL_H,
      kind, hp: 1, lum: 0, seen: 0, everSeen: false, heat: 0, hitT: 0, col: ROW_C[r % ROW_C.length],
    };
    this.blocks.push(b);
    this.grid[r * COLS + c] = b;
  }

  serve() {
    this.balls.push({ x: this.paddleX, y: T.PADDLE_Y - T.PADDLE_HY - T.BALL_R, vx: 0, vy: 0, stuck: true });
  }

  launch(b: Ball) {
    const a = (this.rng() - 0.5) * 0.6;
    b.vx = Math.sin(a) * this.speed;
    b.vy = -Math.cos(a) * this.speed;
    b.stuck = false;
  }

  addBall(x: number, y: number, ang: number) {
    if (this.balls.length >= T.BALL_MAX) return;
    this.balls.push({ x, y, vx: Math.sin(ang) * this.speed, vy: -Math.cos(ang) * this.speed, stuck: false });
  }

  update(dt: number) {
    if (this.paused || this.over) return;
    this.tick(dt);
  }

  // fixed substeps; timeScale > 1 runs the bot faster than real time
  tick(dt: number) {
    let left = dt * this.timeScale;
    while (left > 1e-6) {
      const h = Math.min(1 / 120, left);
      this.step(h);
      left -= h;
      if (this.over) break;
    }
  }

  private step(h: number) {
    this.time += h;
    this.stageT += h;
    if (this.clearT > 0) {
      this.clearT -= h;
      if (this.clearT <= 0) this.newStage(this.stage + 1);
      return;
    }
    if (this.bot) this.botStep();
    // paddle
    const lo = FX0 + T.PADDLE_HX, hi = FX1 - T.PADDLE_HX;
    if (this.input.targetX !== null) this.paddleX = this.input.targetX;
    else this.paddleX += this.input.mx * T.PADDLE_KEY_V * h;
    this.paddleX = Math.max(lo, Math.min(hi, this.paddleX));
    if (this.input.targetX !== null) this.input.targetX = this.paddleX;

    // balls
    for (const b of this.balls) {
      if (b.stuck) {
        b.x = this.paddleX;
        b.y = T.PADDLE_Y - T.PADDLE_HY - T.BALL_R;
        if (this.input.launch) this.launch(b);
        continue;
      }
      this.moveBall(b, h);
    }
    this.input.launch = false;
    const before = this.balls.length;
    this.balls = this.balls.filter((b) => b.y < T.PIT_Y);
    if (this.balls.length < before && this.balls.length === 0) {
      this.counters.lost++;
      this.lives--;
      if (this.lives <= 0) {
        this.over = true;
        return;
      }
      this.onToast(`のこり ${this.lives}`, "#f99");
      this.serve();
    }

    // grains: fall, caught by the paddle into the gauge
    for (let i = 0; i < this.gn; i++) {
      this.gvy[i] += T.GRAIN_G * h;
      this.gx[i] += this.gvx[i] * h;
      this.gy[i] += this.gvy[i] * h;
      if (this.gx[i] < FX0 + T.GRAIN_R) { this.gx[i] = FX0 + T.GRAIN_R; this.gvx[i] = Math.abs(this.gvx[i]) * 0.5; }
      if (this.gx[i] > FX1 - T.GRAIN_R) { this.gx[i] = FX1 - T.GRAIN_R; this.gvx[i] = -Math.abs(this.gvx[i]) * 0.5; }
      if (this.gy[i] < FY0 + T.GRAIN_R) { this.gy[i] = FY0 + T.GRAIN_R; this.gvy[i] = Math.abs(this.gvy[i]) * 0.3; }
      let gone = false;
      if (Math.abs(this.gy[i] - T.PADDLE_Y) < T.PADDLE_HY + T.GRAIN_R && Math.abs(this.gx[i] - this.paddleX) < T.PADDLE_HX + T.GRAIN_R) {
        this.gauge = Math.min(T.GAUGE_MAX, this.gauge + 1);
        this.counters.caught++;
        if (this.gauge === T.GAUGE_MAX) this.onToast("🔆 たまった!はなて!", "#ffd890");
        gone = true;
      } else if (this.gy[i] > T.PIT_Y) {
        this.counters.dropped++;
        gone = true;
      }
      if (gone) {
        const j = --this.gn;
        this.gx[i] = this.gx[j]; this.gy[i] = this.gy[j]; this.gvx[i] = this.gvx[j]; this.gvy[i] = this.gvy[j];
        i--;
      }
    }

    // 🔆 release
    if (this.input.burst) {
      this.input.burst = false;
      if (this.gauge >= T.GAUGE_MAX && this.balls.length) {
        const b = this.balls.reduce((a, c) => (c.y < a.y ? c : a));
        this.gauge = 0;
        this.burstT = T.BURST_T;
        this.counters.bursts++;
        this.flashes.push({ x: b.x, y: b.y, r: T.BURST_R, e: T.BURST_E, c: [1, 0.9, 0.7], life: T.BURST_T, max: T.BURST_T, hot: true, follow: b });
      }
    }
    if (this.burstT > 0) this.burstT -= h;
    for (const f of this.flashes) {
      f.life -= h;
      if (f.follow) { f.x = f.follow.x; f.y = f.follow.y; }
    }
    this.flashes = this.flashes.filter((f) => f.life > 0);

    // light on blocks (lum is read back from the RC solve): seen memory + burning while a hot light is up
    const hot = this.flashes.some((f) => f.hot);
    for (const b of [...this.blocks]) {
      if (b.lum > T.SEEN_LUM) {
        b.seen = T.SEEN_MEMORY;
        b.everSeen = true;
      } else b.seen = Math.max(0, b.seen - h);
      b.hitT = Math.max(0, b.hitT - h);
      if (hot && b.lum > T.HEAT_MIN_LUM) {
        b.heat += (b.lum - T.HEAT_MIN_LUM) * h;
        while (b.heat >= T.HEAT_TO_BREAK && this.blocks.includes(b)) {
          b.heat -= T.HEAT_TO_BREAK;
          this.damage(b, true);
        }
      } else if (!hot) b.heat = Math.max(0, b.heat - h);
    }
    if (this.blocks.length === 0 && this.clearT <= 0) {
      this.counters.clears.push(Math.round(this.stageT * 10) / 10);
      this.score += 500 * this.stage;
      this.clearT = 1.6;
      this.onToast(`ステージ ${this.stage} クリア!`, "#ffd890");
    }
  }

  private moveBall(b: Ball, h: number) {
    const r = T.BALL_R;
    const v = Math.hypot(b.vx, b.vy);
    const n = Math.max(1, Math.ceil((v * h) / T.BALL_SUBSTEP));
    const s = h / n;
    for (let k = 0; k < n; k++) {
      b.x += b.vx * s;
      b.y += b.vy * s;
      if (b.x < FX0 + r) { b.x = FX0 + r; b.vx = Math.abs(b.vx); }
      if (b.x > FX1 - r) { b.x = FX1 - r; b.vx = -Math.abs(b.vx); }
      if (b.y < FY0 + r) { b.y = FY0 + r; b.vy = Math.abs(b.vy); }
      if (this.floorBounce && b.y > T.PIT_Y - 20) { b.y = T.PIT_Y - 20; b.vy = -Math.abs(b.vy); }
      // paddle
      if (b.vy > 0 && b.y + r >= T.PADDLE_Y - T.PADDLE_HY && b.y - r <= T.PADDLE_Y + T.PADDLE_HY && Math.abs(b.x - this.paddleX) <= T.PADDLE_HX + r) {
        const u = Math.max(-1, Math.min(1, (b.x - this.paddleX) / T.PADDLE_HX));
        const a = u * T.PADDLE_MAX_ANGLE;
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.sin(a) * sp;
        b.vy = -Math.cos(a) * sp;
        b.y = T.PADDLE_Y - T.PADDLE_HY - r;
      }
      this.collideBlocks(b);
    }
    // never travel almost flat
    const sp = Math.hypot(b.vx, b.vy);
    if (Math.abs(b.vy) < T.BALL_MIN_VY * sp) {
      b.vy = Math.sign(b.vy || 1) * T.BALL_MIN_VY * sp;
      b.vx = Math.sign(b.vx || 1) * Math.sqrt(sp * sp - b.vy * b.vy);
    }
  }

  // circle vs the block grid; one push-out per substep (substeps are < ball radius, so no tunneling)
  private collideBlocks(b: Ball) {
    const r = T.BALL_R;
    const c0 = Math.floor((b.x - r - FX0) / T.CELL_W), c1 = Math.floor((b.x + r - FX0) / T.CELL_W);
    const r0 = Math.floor((b.y - r - T.BLOCK_TOP) / T.CELL_H), r1 = Math.floor((b.y + r - T.BLOCK_TOP) / T.CELL_H);
    let best: Block | null = null;
    let bestD = r;
    let nx = 0, ny = 0;
    for (let rr = Math.max(0, r0); rr <= Math.min(this.rows - 1, r1); rr++) {
      for (let cc = Math.max(0, c0); cc <= Math.min(COLS - 1, c1); cc++) {
        const k = this.grid[rr * COLS + cc];
        if (!k) continue;
        const dx = b.x - k.x, dy = b.y - k.y;
        const qx = Math.max(-T.BLOCK_HX, Math.min(T.BLOCK_HX, dx)), qy = Math.max(-T.BLOCK_HY, Math.min(T.BLOCK_HY, dy));
        let ex = dx - qx, ey = dy - qy;
        let d = Math.hypot(ex, ey);
        if (d === 0) {
          // center inside the box: leave by the nearest face
          const px = T.BLOCK_HX - Math.abs(dx), py = T.BLOCK_HY - Math.abs(dy);
          if (px < py) { ex = Math.sign(dx) || 1; ey = 0; d = -px; } else { ex = 0; ey = Math.sign(dy) || 1; d = -py; }
        } else { ex /= d; ey /= d; }
        if (d < bestD) { bestD = d; best = k; nx = ex; ny = ey; }
      }
    }
    if (!best) return;
    b.x += nx * (r - bestD);
    b.y += ny * (r - bestD);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    this.hit(best, b);
  }

  private hit(k: Block, b: Ball) {
    this.counters.hits++;
    k.hitT = 0.2;
    this.flashes.push({ x: b.x, y: b.y, r: 3, e: T.HIT_FLASH_E, c: BALL_C, life: T.HIT_FLASH_T, max: T.HIT_FLASH_T, hot: false });
    this.speed = Math.min(T.BALL_VMAX, this.speed + T.BALL_V_PER_HIT);
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) { b.vx *= this.speed / sp; b.vy *= this.speed / sp; }
    if (!this.noBreak) this.damage(k, false);
  }

  damage(k: Block, burned: boolean) {
    k.hp--;
    if (k.hp > 0) return;
    this.blocks.splice(this.blocks.indexOf(k), 1);
    this.grid[k.r * COLS + k.c] = null;
    this.score += burned ? 20 : 10;
    if (burned) this.counters.burned++;
    const drops = k.kind === LANTERN ? T.GRAIN_PER_LANTERN : T.GRAIN_PER_BLOCK;
    for (let i = 0; i < drops; i++) this.addGrain(k.x + (this.rng() - 0.5) * 20, k.y, (this.rng() - 0.5) * 2 * T.GRAIN_POP_V, -this.rng() * T.GRAIN_POP_V);
    if (k.kind === LANTERN) this.flashes.push({ x: k.x, y: k.y, r: T.LANTERN_FLASH_R, e: T.LANTERN_FLASH_E, c: FIRE, life: T.LANTERN_FLASH_T, max: T.LANTERN_FLASH_T, hot: true });
    if (k.kind === ORB) {
      this.addBall(k.x, k.y + T.BLOCK_HY + T.BALL_R + 1, -2.4);
      this.addBall(k.x, k.y + T.BLOCK_HY + T.BALL_R + 1, 2.4);
      this.onToast("💠 ひかりの玉がふえた", "#9fdcff");
    }
  }

  addGrain(x: number, y: number, vx: number, vy: number) {
    if (this.gn >= T.GRAIN_MAX) return;
    const i = this.gn++;
    this.gx[i] = x; this.gy[i] = y; this.gvx[i] = vx; this.gvy[i] = vy;
  }

  // auto paddle: meet the lowest falling ball, aim it at the remaining blocks, release 🔆 among the blocks
  private botStep() {
    const r = T.BALL_R;
    let target: Ball | null = null;
    let tBest = Infinity;
    for (const b of this.balls) {
      if (b.stuck) continue;
      if (b.vy <= 0) continue;
      const t = (T.PADDLE_Y - T.PADDLE_HY - r - b.y) / b.vy;
      if (t >= 0 && t < tBest) { tBest = t; target = b; }
    }
    if (this.balls.some((b) => b.stuck)) this.input.launch = true;
    let x: number;
    if (target) {
      const span = FX1 - FX0 - 2 * r;
      let u = target.x - FX0 - r + target.vx * tBest;
      u = ((u % (2 * span)) + 2 * span) % (2 * span);
      const land = FX0 + r + (u > span ? 2 * span - u : u);
      // aim: the side of the paddle that sends the ball toward the blocks' center of mass
      let cx = (FX0 + FX1) / 2;
      if (this.blocks.length) cx = this.blocks.reduce((s, k) => s + k.x, 0) / this.blocks.length;
      const want = Math.max(-0.8, Math.min(0.8, (cx - land) / 300));
      const noise = ((this.time * 7.31) % 1 - 0.5) * 2 * this.botErr;
      x = land - want * T.PADDLE_HX + noise;
    } else {
      // nothing falling: catch grains
      let gx = this.paddleX;
      let gyBest = -Infinity;
      for (let i = 0; i < this.gn; i++) if (this.gy[i] > gyBest && this.gy[i] < T.PADDLE_Y) { gyBest = this.gy[i]; gx = this.gx[i]; }
      x = gx;
    }
    const maxStep = 900 / 120;
    const cur = this.input.targetX ?? this.paddleX;
    this.input.targetX = cur + Math.max(-maxStep, Math.min(maxStep, x - cur));
    if (this.gauge >= T.GAUGE_MAX && this.blocks.length) {
      const low = Math.max(...this.blocks.map((k) => k.y));
      if (this.balls.some((b) => !b.stuck && b.y < low)) this.input.burst = true;
    }
  }

  frame(cw: number, ch: number, wpp: number): Frame {
    const t = this.time;
    const viewW = cw * wpp;
    const viewH = ch * wpp;
    const camX = (T.MAP_W * T.TILE) / 2 - viewW / 2;
    const camY = (T.MAP_H * T.TILE) / 2 - viewH / 2;
    const S = this.scene, L = this.lit, G = this.glow;
    S.reset(); L.reset(); G.reset();
    let lights = 0;
    const em = (x: number, y: number, r: number, c: V3, e: number) => {
      S.circle(x, y, r, c[0] * e, c[1] * e, c[2] * e, 1);
      lights++;
    };
    const box = (b: Batch, x: number, y: number, hx: number, hy: number, c: V3, a = 1, soft = 0, extra = 0) => b.push(x, y, hx, hy, 0, 1, soft, extra, c[0], c[1], c[2], a);

    // frame walls: a dim neon line inside each
    {
      const i = T.NEON_INSET, e = T.NEON_E, top = FY0 - i, bot = T.MAP_H * T.TILE;
      const lines: [number, number, number, number, V3][] = [[FX0 - i, top, FX0 - i, bot, NEON[0]], [FX1 + i, top, FX1 + i, bot, NEON[1]], [FX0 - i, top, FX1 + i, top, [0.6, 0.45, 0.9]]];
      for (const [x0, y0, x1, y1, c] of lines) {
        S.line(x0, y0, x1, y1, T.NEON_W, c[0] * e, c[1] * e, c[2] * e, 1);
        G.line(x0, y0, x1, y1, 0.5, c[0], c[1], c[2], 0.35, 2);
        lights++;
      }
    }

    // blocks: occluders in the RC scene, lit sprites on screen, a fading outline once seen
    this.probeIdsBuf.length = 0;
    let pc = 0;
    const o = T.RIM_OUT;
    for (const k of this.blocks) {
      const hx = T.BLOCK_HX, hy = T.BLOCK_HY;
      if (k.kind === LANTERN) {
        const fl = 0.75 + 0.25 * Math.sin(t * 5 + k.id);
        S.push(k.x, k.y, hx, hy, 0, 1, 0, 0, FIRE[0] * T.LANTERN_E * fl, FIRE[1] * T.LANTERN_E * fl, FIRE[2] * T.LANTERN_E * fl, 1);
        lights++;
      } else S.push(k.x, k.y, hx, hy, 0, 1, 0, 0, 0, 0, 0, 1);
      const alb: V3 = k.kind === HARD ? [0.42, 0.45, 0.52] : k.kind === LANTERN ? [0.9, 0.42, 0.25] : k.kind === ORB ? [0.4, 0.8, 1] : k.col;
      const hk = k.hitT / 0.2;
      box(L, k.x, k.y, hx, hy, alb, 1, 0, 0.15 * hk + (k.kind === LANTERN ? 0.03 : 0));
      if (k.kind === HARD && k.hp > 1) box(L, k.x, k.y, hx - 4, hy - 3, [alb[0] * 0.6, alb[1] * 0.6, alb[2] * 0.65], 1);
      if (k.kind === ORB) box(L, k.x, k.y, 3, 3, [0.8, 1, 1], 1, 0, 0.2);
      if (k.seen > 0) {
        const a = 0.22 * Math.min(1, k.seen / T.SEEN_MEMORY) ** 0.7;
        const c: V3 = k.kind === ORB ? ORB_C : k.kind === LANTERN ? FIRE : k.kind === HARD ? [0.6, 0.7, 0.9] : [0.75, 0.68, 0.55];
        box(G, k.x, k.y, hx, hy, c, a, 1.2);
      }
      if (k.heat > 0.05) box(G, k.x, k.y, hx, hy, [1, 0.45, 0.1], Math.min(1, k.heat / T.HEAT_TO_BREAK), 2.5);
      if (pc + 4 <= PROBE_N) {
        const pts = [[k.x, k.y - hy - o], [k.x, k.y + hy + o], [k.x - hx - o, k.y], [k.x + hx + o, k.y]];
        for (const q of pts) {
          this.probes[pc * 2] = q[0];
          this.probes[pc * 2 + 1] = q[1];
          this.probeIdsBuf.push(k.id);
          pc++;
        }
      }
    }
    this.probeSerial++;
    this.pendingProbe.set(this.probeSerial, this.probeIdsBuf.slice());
    if (this.pendingProbe.size > 8) this.pendingProbe.delete(this.pendingProbe.keys().next().value!);

    // grains
    for (let i = 0; i < this.gn; i++) {
      em(this.gx[i], this.gy[i], T.GRAIN_R, [1, 0.8, 0.45], T.GRAIN_E);
      G.circle(this.gx[i], this.gy[i], T.GRAIN_R * 0.6, 1, 0.85, 0.55, 0.7, 3);
    }
    for (const f of this.flashes) {
      const k = f.life / f.max;
      em(f.x, f.y, f.r * (1.3 - 0.3 * k), f.c, f.e * k);
      if (f.hot) G.circle(f.x, f.y, f.r, f.c[0], f.c[1], f.c[2], k * 0.6, f.r * 2);
    }
    // paddle: lit body + a faint lamp
    {
      const x = this.paddleX, y = T.PADDLE_Y;
      box(L, x, y, T.PADDLE_HX, T.PADDLE_HY, [0.55, 0.5, 0.45], 1, 0, 0.04);
      em(x, y + T.PADDLE_HY + 2, 2, [1, 0.8, 0.5], T.PADDLE_E);
      G.line(x - T.PADDLE_HX + 3, y - T.PADDLE_HY, x + T.PADDLE_HX - 3, y - T.PADDLE_HY, 0.5, 1, 0.8, 0.5, 0.35 + 0.65 * (this.gauge / T.GAUGE_MAX), 2);
    }
    // balls: the lights
    for (const b of this.balls) {
      em(b.x, b.y, T.BALL_R, BALL_C, b.stuck ? T.SERVE_E : T.BALL_E);
      G.circle(b.x, b.y, T.BALL_R * 0.8, 1, 0.95, 0.8, 1, 5);
    }

    this.lightCount = lights;
    return {
      camX, camY, wpp,
      map: this.map, mapW: T.MAP_W, mapH: T.MAP_H, tile: T.TILE, mapVersion: this.mapVersion,
      scene: S, lit: L, glow: G, probes: this.probes, probeCount: pc,
      view: 0, time: t, exposure: T.EXPOSURE, ambient: T.AMBIENT, bounce: T.BOUNCE, fog: T.FOG, gameFog: T.FOG, gameBounce: T.BOUNCE, toe: T.TONE_TOE, shake: 0,
      side: true, rimOut: T.RIM_OUT,
    };
  }
  private probeIdsBuf: number[] = [];

  applyLum(serial: number, lum: Float32Array, n: number) {
    const ids = this.pendingProbe.get(serial);
    if (!ids) return;
    const byId = new Map(this.blocks.map((k) => [k.id, k]));
    const best = new Map<number, number>();
    for (let i = 0; i < Math.min(n, ids.length); i++) best.set(ids[i], Math.max(best.get(ids[i]) ?? 0, lum[i]));
    for (const [id, v] of best) {
      const k = byId.get(id);
      if (k) k.lum = v;
    }
  }
}

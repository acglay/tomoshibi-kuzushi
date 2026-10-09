// All the knobs. Units are in comments; logic never hard-codes these.
export const T = {
  // field: map tiles are only the frame (left/right/top walls); blocks live on their own grid
  TILE: 16, // world px
  MAP_W: 26, // tiles (1 wall + 24 open + 1 wall)
  MAP_H: 42, // tiles (top wall + open; the bottom is the pit)
  CELL_W: 32, // world px, block grid
  CELL_H: 16,
  BLOCK_HX: 14.5, // world px, half size (gap = 2*(CELL/2 - H))
  BLOCK_HY: 6,
  BLOCK_TOP: 64, // world px, y of the first block row's cell top
  PADDLE_Y: 584, // world px, paddle center
  PIT_Y: 664, // world px: a ball below this is lost

  RC_BASE_INTERVAL: 2, // RC px, cascade0 ray length
  BOUNCE: 0.35, // wall bounce strength (0..1)
  FOG: 0.006, // light absorption per world px
  EXPOSURE: 1.7,
  TONE_TOE: 0.08,
  AMBIENT: 0.002,
  RIM_OUT: 2, // world px: a block face is shaded with the light this far outside it

  NEON_E: 0.22, // dim outline of the frame walls
  NEON_W: 2,
  NEON_INSET: 2,

  // ball = the light
  BALL_R: 4.5, // world px
  BALL_E: 16, // emission
  BALL_V0: 290, // world px/s
  BALL_V_PER_HIT: 2.5, // + per block hit
  BALL_VMAX: 470,
  BALL_MIN_VY: 0.28, // of speed: never let the ball travel almost flat
  BALL_SUBSTEP: 2, // world px: max travel per collision substep
  BALL_MAX: 40,
  SERVE_E: 7, // emission while resting on the paddle

  PADDLE_HX: 34, // world px, half width
  PADDLE_HY: 5,
  PADDLE_MAX_ANGLE: 1.05, // rad from vertical at the paddle's edge
  PADDLE_KEY_V: 520, // world px/s with arrow keys
  PADDLE_E: 1.2, // faint lamp so the paddle can be found in the dark

  // grains of light: fall out of broken blocks, caught by the paddle into the 🔆 gauge
  GRAIN_PER_BLOCK: 1,
  GRAIN_PER_LANTERN: 7,
  GRAIN_R: 2.2,
  GRAIN_E: 6,
  GRAIN_G: 420, // world px/s^2
  GRAIN_POP_V: 120, // world px/s, initial scatter
  GRAIN_MAX: 300,
  GAUGE_MAX: 16, // grains to fill 🔆

  // 🔆 burst: a big light at the ball; blocks that receive light burn (RC readback x time)
  BURST_T: 0.9, // s
  BURST_E: 260, // emission at the start (fades out over BURST_T)
  BURST_R: 9, // world px
  HEAT_MIN_LUM: 0.6, // fluence luminance below this does not heat a block (measured: 🔆 E260 gives 2.1 at 100 px, the ball 0.55 at 30 px)
  HEAT_TO_BREAK: 0.3, // (lum - HEAT_MIN_LUM) * s to burn one hp: 🔆 burns exposed faces out to ~100 px, a lantern its neighbours

  // seeing: blocks are only visible where light reaches them
  SEEN_LUM: 0.08, // max face luminance above this = seen this frame (the ball alone: ~95 px)
  SEEN_MEMORY: 6, // s: the outline of a seen block stays this long, fading

  // block kinds
  LANTERN_E: 0.6, // a faint ember before it breaks
  LANTERN_FLASH_E: 70, // flash when it breaks
  LANTERN_FLASH_T: 1.6, // s
  LANTERN_FLASH_R: 8,
  HIT_FLASH_E: 10,
  HIT_FLASH_T: 0.25,

  // stages
  LIVES: 3,
  STAGE_ROWS: [7, 8, 9, 10, 11, 12], // by stage (last repeats)
  STAGE_FILL: 0.82, // cells holding a block
  P_HARD: [0.0, 0.12, 0.2, 0.28, 0.34], // by stage
  P_LANTERN: 0.07,
  P_ORB: 0.035,
  HARD_HP: 2,
};

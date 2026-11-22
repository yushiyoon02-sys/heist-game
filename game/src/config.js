// Every tuning number, colour and room layout for Slime Heist in one place.
// The playfield is a fixed 1280x720 logical area seen from above; the renderer
// scales it to the window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720, wall: 24 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 15,
  speed: 222,
  sneakSpeed: 116,
  /** Seconds standing at the gem pedestal to pocket the loot. */
  grabSeconds: 0.8,
};

export const GUARD = {
  radius: 15,
  viewRange: 278,
  viewHalfAngle: (37 * Math.PI) / 180,
  turnRate: 2.5,
  pauseSeconds: 1.25,
  sweepAngle: (44 * Math.PI) / 180,
  sweepRate: 0.95,
  /** Seconds a guard spends staring at a decoy coin's landing spot. */
  investigateSeconds: 3.2,
};

export const CAMERA = {
  viewRange: 250,
  viewHalfAngle: (30 * Math.PI) / 180,
  /** Cameras sweep back and forth around their base angle. */
  sweepAngle: (52 * Math.PI) / 180,
  sweepRate: 0.55,
};

export const ALARM = {
  /** Meter gained per second at point blank in a guard's beam. */
  guardFillRate: 1.08,
  /** Meter gained per second inside a camera's cone (cameras are slower to confirm). */
  cameraFillRate: 0.62,
  /** Sneaking multiplies either fill rate by this. */
  sneakFactor: 0.42,
  /** Meter lost per second while nothing can see the thief. */
  decayRate: 0.58,
  /** At this meter a guard stops patrolling and turns toward the thief. */
  suspiciousAt: 0.3,
  /** A room counts as "spotted" (no ghost bonus) once the meter passes this. */
  spottedAt: 0.25,
};

export const TOOLS = {
  /** Decoy coins per room; each use costs score. Guards turn to the noise. */
  decoysPerRoom: 3,
  decoyCost: 50,
  decoyRange: 340,
  /** Smoke puffs per room; each use costs score. Smoke blocks sight lines. */
  smokesPerRoom: 2,
  smokeCost: 75,
  smokeSeconds: 4.2,
  smokeRadius: 62,
};

export const SCORE = {
  roomBase: 1000,
  perSecond: 5,
  roomFloor: 100,
  ghostBonus: 300,
};

export const PALETTE = {
  backdrop: '#0a0d16',
  text: '#eef1f5',
  muted: '#9aa5b5',
  danger: '#e5534b',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best total score is kept between visits (this browser only). */
export const BEST_KEY = 'slime-heist.best';

// Room layouts. Coordinates are logical pixels in the 1280x720 field; the
// border wall (FIELD.wall thick) is added by the world, so layouts only list
// the inner cover. kind 'wall' is a solid block, kind 'case' a glass display
// case, kind 'crate' a stack of crates; all stop movement and sight, so each
// room keeps two or three routes around the patrols. Guard patrols are
// waypoint loops; cameras are fixed mounts with a base facing angle.
export const LEVELS = [
  {
    name: 'Gallery Wing',
    start: { x: 105, y: 615 },
    loot: { x: 1140, y: 110 },
    exit: { x: 1192, y: 315, width: 64, height: 96 },
    cover: [
      { x: 430, y: 150, width: 28, height: 290, kind: 'wall' },
      { x: 770, y: 285, width: 28, height: 300, kind: 'wall' },
      { x: 565, y: 180, width: 225, height: 28, kind: 'wall' },
      { x: 235, y: 305, width: 100, height: 62, kind: 'case' },
      { x: 560, y: 470, width: 120, height: 62, kind: 'crate' },
      { x: 885, y: 185, width: 85, height: 62, kind: 'case' },
      { x: 905, y: 520, width: 105, height: 62, kind: 'crate' },
      { x: 180, y: 470, width: 85, height: 56, kind: 'case' },
    ],
    guards: [
      { speed: 74, waypoints: [{ x: 370, y: 160 }, { x: 370, y: 555 }] },
      { speed: 84, waypoints: [{ x: 1045, y: 600 }, { x: 1045, y: 140 }] },
    ],
    cameras: [
      { x: 1000, y: 44, angle: Math.PI / 2 },
    ],
  },
  {
    name: 'Vault Corridor',
    start: { x: 105, y: 110 },
    loot: { x: 1145, y: 640 },
    exit: { x: 1192, y: 110, width: 64, height: 96 },
    cover: [
      { x: 305, y: 24, width: 28, height: 245, kind: 'wall' },
      { x: 305, y: 435, width: 28, height: 261, kind: 'wall' },
      { x: 625, y: 185, width: 28, height: 295, kind: 'wall' },
      { x: 945, y: 24, width: 28, height: 255, kind: 'wall' },
      { x: 945, y: 465, width: 28, height: 231, kind: 'wall' },
      { x: 435, y: 335, width: 200, height: 28, kind: 'wall' },
      { x: 65, y: 305, width: 85, height: 62, kind: 'case' },
      { x: 460, y: 125, width: 100, height: 62, kind: 'crate' },
      { x: 765, y: 335, width: 115, height: 62, kind: 'case' },
      { x: 765, y: 545, width: 100, height: 55, kind: 'crate' },
      { x: 460, y: 545, width: 100, height: 62, kind: 'case' },
      { x: 985, y: 305, width: 85, height: 62, kind: 'crate' },
    ],
    guards: [
      { speed: 80, waypoints: [{ x: 185, y: 600 }, { x: 185, y: 185 }] },
      { speed: 88, waypoints: [{ x: 485, y: 620 }, { x: 805, y: 620 }] },
      { speed: 84, waypoints: [{ x: 1085, y: 620 }, { x: 1085, y: 255 }] },
    ],
    cameras: [
      { x: 470, y: 676, angle: -Math.PI / 2 },
      { x: 1000, y: 44, angle: Math.PI / 2 },
    ],
  },
  {
    name: 'The Gem Vault',
    start: { x: 105, y: 360 },
    loot: { x: 640, y: 360 },
    exit: { x: 1192, y: 312, width: 64, height: 96 },
    cover: [
      { x: 350, y: 120, width: 28, height: 200, kind: 'wall' },
      { x: 350, y: 400, width: 28, height: 200, kind: 'wall' },
      { x: 902, y: 120, width: 28, height: 200, kind: 'wall' },
      { x: 902, y: 400, width: 28, height: 200, kind: 'wall' },
      { x: 505, y: 235, width: 270, height: 28, kind: 'wall' },
      { x: 505, y: 457, width: 270, height: 28, kind: 'wall' },
      { x: 180, y: 150, width: 95, height: 60, kind: 'case' },
      { x: 180, y: 510, width: 95, height: 60, kind: 'case' },
      { x: 1005, y: 150, width: 95, height: 60, kind: 'crate' },
      { x: 1005, y: 510, width: 95, height: 60, kind: 'crate' },
      { x: 590, y: 300, width: 100, height: 40, kind: 'case' },
    ],
    guards: [
      { speed: 86, waypoints: [{ x: 240, y: 140 }, { x: 240, y: 580 }] },
      { speed: 92, waypoints: [{ x: 640, y: 160 }, { x: 640, y: 560 }] },
      { speed: 88, waypoints: [{ x: 1040, y: 580 }, { x: 1040, y: 140 }] },
    ],
    cameras: [
      { x: 1000, y: 44, angle: Math.PI / 2 },
      { x: 640, y: 676, angle: -Math.PI / 2 },
    ],
  },
];

// Drawing only: the world's state and the current screen in, pixels out. The
// 1280x720 playfield is scaled to fit the window and centred, the margin
// filled with the backdrop colour. Anime cel-shaded art, all drawn with
// canvas paths (no flat colour blocks): the thief is a pink slime in a
// bandit mask with a loot bag, guards are indigo slimes in caps carrying
// flashlights, cameras are wall CCTV units with sweeping cones, the floor
// is veined museum marble, walls are brick, cover is glass display cases
// and planked crates, and the loot is a faceted gem on a pedestal. Vision
// cones are light beams (radial gradient, clipped by cover with raycasts)
// so what the player sees is what the watchers can see.
import { CAMERA, FIELD, FONT, GUARD, PALETTE, TOOLS } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_CAUGHT = 'caught';
export const SCREEN_WIN = 'win';

/** The panel's width; its height grows with its lines. */
const PANEL = { width: 700, top: 150, line: 34, bottom: 78 };
const CONE_RAYS = 30;
const TILE = 80;

const ART = {
  outline: '#241f3d',
  marbleA: '#4a5578',
  marbleB: '#414d6e',
  marbleGrout: '#2c3552',
  marbleHi: 'rgba(205, 220, 255, 0.12)',
  vein: 'rgba(190, 205, 255, 0.16)',
  stain: 'rgba(14, 18, 38, 0.20)',
  rope: 'rgba(255, 125, 156, 0.35)',
  brick: '#5d6d99',
  brickDark: '#46537a',
  brickTop: '#8595bd',
  brickLine: '#39466b',
  wood: '#b0824f',
  woodDark: '#8a6136',
  woodLight: '#c99a63',
  glass: 'rgba(160, 220, 255, 0.30)',
  glassHi: 'rgba(255, 255, 255, 0.45)',
  caseBase: '#6b4a8a',
  caseBaseDark: '#4e3466',
  thiefBody: '#ff9ec4',
  thiefShade: '#f06fa8',
  thiefDeep: '#c94f86',
  mask: '#2b2440',
  bag: '#8a6136',
  guardBody: '#7a6fd0',
  guardShade: '#57499f',
  guardDeep: '#41357c',
  cap: '#2e3a67',
  capBrim: '#232c50',
  gold: '#f2c94c',
  eye: '#2b2440',
  blush: 'rgba(255, 130, 160, 0.55)',
  gem: '#5ef2d6',
  gemDark: '#25b79a',
  gemHi: '#d8fff4',
  exitGlow: '#4fe3a5',
  panelTop: '#3a4470',
  panelBottom: '#252c4d',
  panelEdge: '#8fa3d9',
  hudBack: 'rgba(24, 28, 52, 0.72)',
  hudEdge: 'rgba(160, 180, 235, 0.45)',
  beam: 'rgba(255, 226, 140, ',
  beamAlert: 'rgba(255, 110, 100, ',
  camBeam: 'rgba(140, 210, 255, ',
  camBeamAlert: 'rgba(255, 110, 100, ',
};

function cachedLabel(prefix) {
  let value = null;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

/** Deterministic 0..1 hash from two integers, for stable texture variation. */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Distance along a ray from (x, y) in direction (dx, dy) to a rectangle, or Infinity. */
function rayRect(x, y, dx, dy, rect) {
  let tMin = 0;
  let tMax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (x < rect.x || x > rect.x + rect.width) return Infinity;
  } else {
    let t1 = (rect.x - x) / dx;
    let t2 = (rect.x + rect.width - x) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  if (Math.abs(dy) < 1e-9) {
    if (y < rect.y || y > rect.y + rect.height) return Infinity;
  } else {
    let t1 = (rect.y - y) / dy;
    let t2 = (rect.y + rect.height - y) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  return tMax >= tMin ? tMin : Infinity;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const scoreLabel = cachedLabel('Score ');
  const finalLabel = cachedLabel('Score ');
  const bestLabel = cachedLabel('Best ');
  const motion = new WeakMap();
  let floorCanvas = null;
  let vignette = null;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  /** A mouse position in client pixels, in logical playfield coordinates. */
  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * canvas.width;
    const py = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
  }

  const fonts = new Map();
  function setFont(size, weight) {
    const key = `${weight || ''}:${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight ? `${weight} ` : ''}${size}px ${FONT}`);
    context.font = fonts.get(key);
  }

  function text(value, x, y, size, color, align, weight) {
    setFont(size, weight);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function outlineText(value, x, y, size, color, align, weight) {
    setFont(size, weight);
    context.textAlign = align;
    context.lineJoin = 'round';
    context.strokeStyle = ART.outline;
    context.lineWidth = Math.max(3, size / 7);
    context.strokeText(value, x, y);
    context.fillStyle = color;
    context.fillText(value, x, y);
  }

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + rr, y);
    context.lineTo(x + w - rr, y);
    context.arcTo(x + w, y, x + w, y + rr, rr);
    context.lineTo(x + w, y + h - rr);
    context.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    context.lineTo(x + rr, y + h);
    context.arcTo(x, y + h, x, y + h - rr, rr);
    context.lineTo(x, y + rr);
    context.arcTo(x, y, x + rr, y, rr);
    context.closePath();
  }

  /** Walk-cycle phase and squash for an entity, tracked between frames. */
  function motionOf(entity, totalTime) {
    let m = motion.get(entity);
    if (!m) {
      m = { x: entity.x, y: entity.y, phase: 0, moving: false };
      motion.set(entity, m);
    }
    const dx = entity.x - m.x;
    const dy = entity.y - m.y;
    const dist = Math.hypot(dx, dy);
    m.moving = dist > 0.05;
    if (m.moving) m.phase += dist * 0.32;
    m.x = entity.x;
    m.y = entity.y;
    const bob = m.moving ? Math.sin(m.phase) * 0.09 : Math.sin(totalTime * 2.4 + entity.x * 0.02) * 0.035;
    return { phase: m.phase, moving: m.moving, squash: bob };
  }

  // ---- Floor (pre-rendered once): cel-shaded marble tiles, veins, stains. ----
  function buildFloor() {
    floorCanvas = document.createElement('canvas');
    floorCanvas.width = FIELD.width;
    floorCanvas.height = FIELD.height;
    const g = floorCanvas.getContext('2d');
    g.fillStyle = ART.marbleA;
    g.fillRect(0, 0, FIELD.width, FIELD.height);
    for (let ty = 0; ty * TILE < FIELD.height; ty += 1) {
      for (let tx = 0; tx * TILE < FIELD.width; tx += 1) {
        const x = tx * TILE;
        const y = ty * TILE;
        const v = hash2(tx, ty);
        // Checkerboard marble with per-tile tone variation.
        g.fillStyle = (tx + ty) % 2 === 0 ? ART.marbleA : ART.marbleB;
        g.fillRect(x, y, TILE, TILE);
        if (v > 0.7) {
          g.fillStyle = 'rgba(255, 255, 255, 0.05)';
          g.fillRect(x, y, TILE, TILE);
        }
        // Cel highlight along the top and left edge of each tile.
        g.fillStyle = ART.marbleHi;
        g.fillRect(x, y, TILE, 4);
        g.fillRect(x, y, 4, TILE);
        // Marble veins: two wavy strokes per tile.
        g.strokeStyle = ART.vein;
        g.lineWidth = 2;
        for (let vein = 0; vein < 2; vein += 1) {
          const vy = y + 14 + hash2(tx * 3 + vein, ty * 7) * (TILE - 28);
          g.beginPath();
          g.moveTo(x + 4, vy);
          g.bezierCurveTo(
            x + TILE * 0.35, vy - 6 + hash2(tx, ty + vein) * 12,
            x + TILE * 0.65, vy + 6 - hash2(tx + vein, ty) * 12,
            x + TILE - 4, vy + (hash2(tx * 9, ty * 5 + vein) - 0.5) * 14,
          );
          g.stroke();
        }
        // Speckles.
        g.fillStyle = 'rgba(20, 26, 48, 0.25)';
        for (let s = 0; s < 4; s += 1) {
          const sx = x + hash2(tx * 7 + s, ty * 3) * (TILE - 6) + 3;
          const sy = y + hash2(tx * 5, ty * 11 + s) * (TILE - 6) + 3;
          g.fillRect(sx, sy, 3, 2);
        }
      }
    }
    // Grout lines.
    g.strokeStyle = ART.marbleGrout;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= FIELD.width; x += TILE) { g.moveTo(x, 0); g.lineTo(x, FIELD.height); }
    for (let y = 0; y <= FIELD.height; y += TILE) { g.moveTo(0, y); g.lineTo(FIELD.width, y); }
    g.stroke();
    // Stains: soft dark blobs.
    for (let i = 0; i < 12; i += 1) {
      const sx = hash2(i, 31) * FIELD.width;
      const sy = hash2(17, i) * FIELD.height;
      const r = 30 + hash2(i, 7) * 70;
      const grad = g.createRadialGradient(sx, sy, 4, sx, sy, r);
      grad.addColorStop(0, ART.stain);
      grad.addColorStop(1, 'rgba(14, 18, 38, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
    }
    // Museum rope-line paint across the middle.
    g.strokeStyle = ART.rope;
    g.lineWidth = 5;
    g.setLineDash([26, 20]);
    g.beginPath();
    g.moveTo(FIELD.wall + 30, FIELD.height / 2);
    g.lineTo(FIELD.width - FIELD.wall - 30, FIELD.height / 2);
    g.stroke();
    g.setLineDash([]);
  }

  function buildVignette() {
    vignette = context.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.42,
      FIELD.width / 2, FIELD.height / 2, FIELD.width * 0.72,
    );
    vignette.addColorStop(0, 'rgba(10, 10, 30, 0)');
    vignette.addColorStop(1, 'rgba(10, 10, 30, 0.38)');
  }

  // ---- Vision cones as light beams, clipped by cover. ----
  function beamPoints(state, ox, oy, angle, halfAngle, range) {
    const points = [];
    for (let index = 0; index <= CONE_RAYS; index += 1) {
      const a = angle - halfAngle + (2 * halfAngle * index) / CONE_RAYS;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let dist = range;
      for (const rect of state.cover) {
        const hit = rayRect(ox, oy, dx, dy, rect);
        if (hit < dist) dist = hit;
      }
      points.push([ox + dx * dist, oy + dy * dist]);
    }
    return points;
  }

  function drawBeam(state, ox, oy, angle, halfAngle, range, base) {
    const points = beamPoints(state, ox, oy, angle, halfAngle, range);
    const beamPath = (scale) => {
      context.beginPath();
      context.moveTo(ox, oy);
      for (const [px, py] of points) {
        context.lineTo(ox + (px - ox) * scale, oy + (py - oy) * scale);
      }
      context.closePath();
    };
    // Outer soft beam.
    beamPath(1);
    let grad = context.createRadialGradient(ox, oy, 6, ox, oy, range);
    grad.addColorStop(0, `${base}0.50)`);
    grad.addColorStop(0.55, `${base}0.26)`);
    grad.addColorStop(1, `${base}0.02)`);
    context.fillStyle = grad;
    context.fill();
    // Brighter core near the lamp.
    beamPath(0.55);
    grad = context.createRadialGradient(ox, oy, 4, ox, oy, range * 0.55);
    grad.addColorStop(0, `${base}0.55)`);
    grad.addColorStop(1, `${base}0.05)`);
    context.fillStyle = grad;
    context.fill();
  }

  function drawGuardBeam(state, guard) {
    drawBeam(state, guard.x, guard.y, guard.angle, GUARD.viewHalfAngle, GUARD.viewRange, guard.alert ? ART.beamAlert : ART.beam);
  }

  function drawCameraBeam(state, camera) {
    drawBeam(state, camera.x, camera.y, camera.angle, CAMERA.viewHalfAngle, CAMERA.viewRange, camera.alert ? ART.camBeamAlert : ART.camBeam);
  }

  // ---- Cover: brick walls, glass cases, planked crates. ----
  function drawShadow(rect) {
    context.fillStyle = 'rgba(12, 14, 32, 0.35)';
    context.fillRect(rect.x + 5, rect.y + 7, rect.width, rect.height);
  }

  function drawWall(rect) {
    drawShadow(rect);
    const grad = context.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
    grad.addColorStop(0, ART.brickTop);
    grad.addColorStop(0.18, ART.brick);
    grad.addColorStop(1, ART.brickDark);
    context.fillStyle = grad;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    const course = 16;
    const brickW = 34;
    context.strokeStyle = ART.brickLine;
    context.lineWidth = 2;
    context.beginPath();
    for (let y = rect.y + course; y < rect.y + rect.height; y += course) {
      context.moveTo(rect.x, y);
      context.lineTo(rect.x + rect.width, y);
    }
    context.stroke();
    context.beginPath();
    let row = 0;
    for (let y = rect.y; y < rect.y + rect.height; y += course) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      for (let x = rect.x + offset; x < rect.x + rect.width; x += brickW) {
        if (x > rect.x) {
          context.moveTo(x, y);
          context.lineTo(x, Math.min(y + course, rect.y + rect.height));
        }
      }
      row += 1;
    }
    context.stroke();
    context.fillStyle = 'rgba(210, 225, 255, 0.35)';
    context.fillRect(rect.x, rect.y, rect.width, 4);
    context.strokeStyle = ART.outline;
    context.lineWidth = 2.5;
    context.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  }

  function drawCase(rect) {
    drawShadow(rect);
    const { x, y, width: w, height: h } = rect;
    // Wooden base.
    const baseGrad = context.createLinearGradient(x, y, x, y + h);
    baseGrad.addColorStop(0, ART.caseBase);
    baseGrad.addColorStop(1, ART.caseBaseDark);
    context.fillStyle = baseGrad;
    context.fillRect(x, y + h * 0.62, w, h * 0.38);
    // Glass top.
    context.fillStyle = ART.glass;
    context.fillRect(x, y, w, h * 0.66);
    // Exhibit inside: a tiny vase silhouette.
    context.fillStyle = 'rgba(242, 201, 76, 0.85)';
    context.beginPath();
    context.ellipse(x + w / 2, y + h * 0.42, w * 0.13, h * 0.2, 0, 0, Math.PI * 2);
    context.fill();
    context.fillRect(x + w / 2 - w * 0.06, y + h * 0.14, w * 0.12, h * 0.12);
    // Glass highlight diagonal.
    context.strokeStyle = ART.glassHi;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(x + w * 0.18, y + h * 0.6);
    context.lineTo(x + w * 0.42, y + 5);
    context.stroke();
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x + w * 0.5, y + h * 0.6);
    context.lineTo(x + w * 0.64, y + 5);
    context.stroke();
    // Frame.
    context.strokeStyle = ART.caseBaseDark;
    context.lineWidth = 4;
    context.strokeRect(x + 2, y + 2, w - 4, h - 4);
    context.strokeStyle = ART.outline;
    context.lineWidth = 2.5;
    context.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawCrate(rect) {
    drawShadow(rect);
    const { x, y, width: w, height: h } = rect;
    context.fillStyle = ART.wood;
    context.fillRect(x, y, w, h);
    const planks = 3;
    const ph = h / planks;
    for (let i = 0; i < planks; i += 1) {
      const py = y + i * ph;
      context.fillStyle = i % 2 === 0 ? ART.woodLight : ART.wood;
      context.fillRect(x + 3, py + 3, w - 6, ph - 6);
      context.strokeStyle = 'rgba(111, 76, 39, 0.55)';
      context.lineWidth = 1.5;
      context.beginPath();
      for (let gline = 0; gline < 2; gline += 1) {
        const gy = py + ph * (0.35 + gline * 0.3);
        context.moveTo(x + 8, gy);
        context.bezierCurveTo(x + w * 0.35, gy - 2, x + w * 0.65, gy + 2, x + w - 8, gy);
      }
      context.stroke();
    }
    context.strokeStyle = ART.woodDark;
    context.lineWidth = 6;
    context.strokeRect(x + 3, y + 3, w - 6, h - 6);
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(x + 5, y + h - 5);
    context.lineTo(x + w - 5, y + 5);
    context.stroke();
    context.fillStyle = '#4a3319';
    for (const [nx, ny] of [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8]]) {
      context.beginPath();
      context.arc(nx, ny, 2.4, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = ART.outline;
    context.lineWidth = 2.5;
    context.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function drawCover(rect) {
    if (rect.kind === 'case') drawCase(rect);
    else if (rect.kind === 'crate') drawCrate(rect);
    else drawWall(rect);
  }

  // ---- Getaway door: a glowing sign door with light spilling out. ----
  function drawExit(state) {
    const exit = state.exit;
    const open = state.hasLoot;
    const pulse = 0.75 + 0.25 * Math.sin(state.totalTime * 3.2);
    if (open) {
      const spill = context.createLinearGradient(exit.x, 0, exit.x - 90, 0);
      spill.addColorStop(0, `rgba(79, 227, 165, ${0.28 * pulse})`);
      spill.addColorStop(1, 'rgba(79, 227, 165, 0)');
      context.fillStyle = spill;
      context.beginPath();
      context.moveTo(exit.x, exit.y + 6);
      context.lineTo(exit.x - 90, exit.y - 14);
      context.lineTo(exit.x - 90, exit.y + exit.height + 14);
      context.lineTo(exit.x, exit.y + exit.height - 6);
      context.closePath();
      context.fill();
    }
    context.fillStyle = '#1d2b26';
    context.fillRect(exit.x - 4, exit.y - 4, exit.width + 8, exit.height + 8);
    const doorGrad = context.createLinearGradient(exit.x, exit.y, exit.x, exit.y + exit.height);
    doorGrad.addColorStop(0, open ? '#57d9a3' : '#5d7268');
    doorGrad.addColorStop(1, open ? '#2f9d72' : '#42534b');
    context.fillStyle = doorGrad;
    context.fillRect(exit.x, exit.y, exit.width, exit.height);
    context.strokeStyle = 'rgba(20, 40, 32, 0.55)';
    context.lineWidth = 2;
    context.strokeRect(exit.x + 7, exit.y + 26, exit.width - 14, exit.height - 36);
    context.fillStyle = '#ffe9a8';
    context.beginPath();
    context.arc(exit.x + 12, exit.y + exit.height / 2 + 12, 3.5, 0, Math.PI * 2);
    context.fill();
    context.save();
    if (open) {
      context.shadowColor = ART.exitGlow;
      context.shadowBlur = 16 * pulse;
    }
    roundRectPath(exit.x + 4, exit.y + 4, exit.width - 8, 22, 6);
    context.fillStyle = open ? '#eafff5' : '#9fb3a8';
    context.fill();
    context.restore();
    context.textBaseline = 'middle';
    text('EXIT', exit.x + exit.width / 2, exit.y + 16, 15, open ? '#14724e' : '#3d4f46', 'center', 'bold');
    if (open) {
      text('GO!', exit.x + exit.width / 2, exit.y + exit.height - 12, 14, '#eafff5', 'center', 'bold');
    } else {
      const lx = exit.x + exit.width / 2;
      const ly = exit.y + exit.height - 16;
      context.strokeStyle = '#d7e6de';
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(lx, ly - 4, 5, Math.PI, 0);
      context.stroke();
      context.fillStyle = '#d7e6de';
      roundRectPath(lx - 7, ly - 4, 14, 11, 3);
      context.fill();
      context.fillStyle = '#42534b';
      context.beginPath();
      context.arc(lx, ly + 1, 2.2, 0, Math.PI * 2);
      context.fill();
    }
  }

  // ---- Loot: a faceted gem on a pedestal, with a grab ring. ----
  function drawGem(cx, cy, size) {
    const s = size;
    // Crown (top) facet.
    context.fillStyle = ART.gemHi;
    context.beginPath();
    context.moveTo(cx - s, cy - s * 0.25);
    context.lineTo(cx - s * 0.55, cy - s * 0.8);
    context.lineTo(cx + s * 0.55, cy - s * 0.8);
    context.lineTo(cx + s, cy - s * 0.25);
    context.closePath();
    context.fill();
    // Body facet.
    context.fillStyle = ART.gem;
    context.beginPath();
    context.moveTo(cx - s, cy - s * 0.25);
    context.lineTo(cx + s, cy - s * 0.25);
    context.lineTo(cx, cy + s);
    context.closePath();
    context.fill();
    // Shade facet.
    context.fillStyle = ART.gemDark;
    context.beginPath();
    context.moveTo(cx, cy - s * 0.25);
    context.lineTo(cx + s, cy - s * 0.25);
    context.lineTo(cx, cy + s);
    context.closePath();
    context.fill();
    // Facet lines + outline.
    context.strokeStyle = ART.outline;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cx - s, cy - s * 0.25);
    context.lineTo(cx - s * 0.55, cy - s * 0.8);
    context.lineTo(cx + s * 0.55, cy - s * 0.8);
    context.lineTo(cx + s, cy - s * 0.25);
    context.lineTo(cx, cy + s);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.moveTo(cx - s, cy - s * 0.25);
    context.lineTo(cx + s, cy - s * 0.25);
    context.moveTo(cx, cy - s * 0.8);
    context.lineTo(cx, cy - s * 0.25);
    context.stroke();
    // Sparkle.
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(cx - s * 0.35, cy - s * 1.05);
    context.lineTo(cx - s * 0.22, cy - s * 0.6);
    context.lineTo(cx - s * 0.35, cy - s * 0.25);
    context.lineTo(cx - s * 0.48, cy - s * 0.6);
    context.closePath();
    context.fill();
  }

  function drawLoot(state, pulse) {
    const p = state.lootPos;
    const halo = context.createRadialGradient(p.x, p.y, 4, p.x, p.y, 38 + pulse * 9);
    halo.addColorStop(0, 'rgba(140, 255, 230, 0.5)');
    halo.addColorStop(1, 'rgba(140, 255, 230, 0)');
    context.fillStyle = halo;
    context.beginPath();
    context.arc(p.x, p.y, 38 + pulse * 9, 0, Math.PI * 2);
    context.fill();
    // Pedestal.
    context.fillStyle = 'rgba(12, 14, 32, 0.35)';
    context.beginPath();
    context.ellipse(p.x, p.y + 20, 24, 7, 0, 0, Math.PI * 2);
    context.fill();
    const pedGrad = context.createLinearGradient(p.x, p.y + 4, p.x, p.y + 20);
    pedGrad.addColorStop(0, '#8fa3d9');
    pedGrad.addColorStop(1, '#46537a');
    context.fillStyle = pedGrad;
    context.beginPath();
    context.moveTo(p.x - 13, p.y + 18);
    context.lineTo(p.x - 9, p.y + 4);
    context.lineTo(p.x + 9, p.y + 4);
    context.lineTo(p.x + 13, p.y + 18);
    context.closePath();
    context.fill();
    context.strokeStyle = ART.outline;
    context.lineWidth = 2;
    context.stroke();
    drawGem(p.x, p.y - 6 - pulse * 2, 15);
    // Orbiting sparkles.
    context.fillStyle = '#d8fff4';
    for (let i = 0; i < 3; i += 1) {
      const a = state.totalTime * 1.6 + i * 2.1;
      const sx = p.x + Math.cos(a) * 27;
      const sy = p.y - 10 + Math.sin(a) * 13;
      const r = 3 + Math.sin(state.totalTime * 4 + i) * 1.2;
      context.beginPath();
      context.moveTo(sx, sy - r * 1.8);
      context.lineTo(sx + r * 0.5, sy);
      context.lineTo(sx, sy + r * 1.8);
      context.lineTo(sx - r * 0.5, sy);
      context.closePath();
      context.fill();
    }
    // Grab progress ring.
    if (state.grabProgress > 0) {
      context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      context.lineWidth = 5;
      context.beginPath();
      context.arc(p.x, p.y - 4, 30, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = ART.gem;
      context.beginPath();
      context.arc(p.x, p.y - 4, 30, -Math.PI / 2, -Math.PI / 2 + state.grabProgress * Math.PI * 2);
      context.stroke();
      context.textBaseline = 'middle';
      text('GRABBING…', p.x, p.y - 48, 14, '#d8fff4', 'center', 'bold');
    }
  }

  // ---- Smoke puffs and the decoy coin. ----
  function drawSmoke(state) {
    for (const smoke of state.smokes) {
      const fade = Math.min(1, smoke.timer / 1.2);
      for (let i = 0; i < 5; i += 1) {
        const a = i * 1.7 + smoke.x * 0.01;
        const ox = Math.cos(a) * TOOLS.smokeRadius * 0.4;
        const oy = Math.sin(a) * TOOLS.smokeRadius * 0.3;
        const r = TOOLS.smokeRadius * (0.55 + hash2(i, Math.floor(smoke.x)) * 0.3);
        const grad = context.createRadialGradient(smoke.x + ox, smoke.y + oy, 2, smoke.x + ox, smoke.y + oy, r);
        grad.addColorStop(0, `rgba(220, 226, 240, ${0.55 * fade})`);
        grad.addColorStop(1, 'rgba(220, 226, 240, 0)');
        context.fillStyle = grad;
        context.beginPath();
        context.arc(smoke.x + ox, smoke.y + oy, r, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function drawDecoy(state) {
    const d = state.decoy;
    if (!d) return;
    const pulse = (Math.sin(state.totalTime * 8) + 1) / 2;
    context.strokeStyle = `rgba(242, 201, 76, ${0.5 + pulse * 0.4})`;
    context.lineWidth = 2.5;
    context.beginPath();
    context.arc(d.x, d.y, 12 + pulse * 6, 0, Math.PI * 2);
    context.stroke();
    // The coin itself.
    context.fillStyle = ART.gold;
    context.beginPath();
    context.ellipse(d.x, d.y, 8, 5.5, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#8a6a1a';
    context.lineWidth = 1.8;
    context.stroke();
    context.textBaseline = 'middle';
    text('♪', d.x + 12, d.y - 12, 18, ART.gold, 'left', 'bold');
  }

  // ---- Slimes: cel-shaded dome bodies with faces. ----
  function slimeBody(x, y, r, squash, body, shade, deep) {
    const w = r * (1 + squash);
    const h = r * (1 - squash * 0.7);
    context.fillStyle = 'rgba(12, 14, 32, 0.35)';
    context.beginPath();
    context.ellipse(x, y + h * 0.82, w * 0.95, h * 0.3, 0, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x - w, y + h * 0.55);
    context.bezierCurveTo(x - w, y - h * 0.55, x - w * 0.45, y - h, x, y - h);
    context.bezierCurveTo(x + w * 0.45, y - h, x + w, y - h * 0.55, x + w, y + h * 0.55);
    context.bezierCurveTo(x + w, y + h * 0.85, x + w * 0.5, y + h * 0.95, x, y + h * 0.95);
    context.bezierCurveTo(x - w * 0.5, y + h * 0.95, x - w, y + h * 0.85, x - w, y + h * 0.55);
    context.closePath();
    const grad = context.createLinearGradient(x, y - h, x, y + h);
    grad.addColorStop(0, body);
    grad.addColorStop(0.62, body);
    grad.addColorStop(1, shade);
    context.fillStyle = grad;
    context.fill();
    context.save();
    context.clip();
    context.fillStyle = shade;
    context.beginPath();
    context.ellipse(x, y + h * 1.15, w * 1.05, h * 0.55, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255, 255, 255, 0.20)';
    context.beginPath();
    context.ellipse(x - w * 0.35, y - h * 0.45, w * 0.34, h * 0.2, -0.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.strokeStyle = deep;
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(x - w, y + h * 0.55);
    context.bezierCurveTo(x - w, y - h * 0.55, x - w * 0.45, y - h, x, y - h);
    context.bezierCurveTo(x + w * 0.45, y - h, x + w, y - h * 0.55, x + w, y + h * 0.55);
    context.bezierCurveTo(x + w, y + h * 0.85, x + w * 0.5, y + h * 0.95, x, y + h * 0.95);
    context.bezierCurveTo(x - w * 0.5, y + h * 0.95, x - w, y + h * 0.85, x - w, y + h * 0.55);
    context.closePath();
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.75)';
    context.beginPath();
    context.ellipse(x - w * 0.38, y - h * 0.52, w * 0.2, h * 0.11, -0.6, 0, Math.PI * 2);
    context.fill();
  }

  function slimeFace(x, y, r, angle, opts) {
    const lookX = Math.cos(angle) * r * 0.16;
    const lookY = Math.sin(angle) * r * 0.1;
    const eyeY = y - r * 0.08 + lookY;
    const spread = r * 0.34;
    for (const dir of [-1, 1]) {
      const ex = x + dir * spread + lookX;
      context.fillStyle = ART.eye;
      context.beginPath();
      context.ellipse(ex, eyeY, r * 0.11, r * 0.17, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(ex - r * 0.03, eyeY - r * 0.06, r * 0.045, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = ART.eye;
    context.lineWidth = 2;
    context.beginPath();
    if (opts && opts.surprised) {
      context.arc(x + lookX, y + r * 0.24, r * 0.1, 0, Math.PI * 2);
      context.fillStyle = ART.eye;
      context.fill();
    } else if (opts && opts.sly) {
      // A sly side-smile for the thief.
      context.arc(x + lookX + r * 0.06, y + r * 0.1, r * 0.16, 0.15 * Math.PI, 0.62 * Math.PI);
      context.stroke();
    } else {
      context.arc(x + lookX, y + r * 0.14, r * 0.14, 0.25 * Math.PI, 0.75 * Math.PI);
      context.stroke();
    }
    context.fillStyle = ART.blush;
    for (const dir of [-1, 1]) {
      context.beginPath();
      context.ellipse(x + dir * r * 0.58 + lookX, y + r * 0.16, r * 0.16, r * 0.09, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  function alertBubble(x, y, mark, color) {
    context.save();
    context.translate(x, y);
    context.fillStyle = '#fff7d6';
    context.strokeStyle = color;
    context.lineWidth = 2.5;
    context.beginPath();
    const spikes = 10;
    for (let i = 0; i < spikes * 2; i += 1) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? 15 : 10.5;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.textBaseline = 'middle';
    text(mark, 0, 1, 19, color, 'center', 'bold');
    context.restore();
  }

  function sweatDrop(x, y, t) {
    const bob = Math.sin(t * 6) * 2;
    context.fillStyle = '#9fdcff';
    context.strokeStyle = '#4d9fd6';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x, y - 8 + bob);
    context.bezierCurveTo(x + 5, y + bob, x + 5.5, y + 4 + bob, x, y + 6 + bob);
    context.bezierCurveTo(x - 5.5, y + 4 + bob, x - 5, y + bob, x, y - 8 + bob);
    context.fill();
    context.stroke();
    context.fillStyle = 'rgba(255,255,255,0.8)';
    context.beginPath();
    context.arc(x - 1.5, y + 1 + bob, 1.4, 0, Math.PI * 2);
    context.fill();
  }

  function drawGuard(state, guard) {
    const m = motionOf(guard, state.totalTime);
    const r = GUARD.radius + 3;
    slimeBody(guard.x, guard.y, r, m.squash, ART.guardBody, ART.guardShade, ART.guardDeep);
    const fx = Math.cos(guard.angle);
    const fy = Math.sin(guard.angle);
    // Cap: dome + brim toward facing.
    context.fillStyle = ART.cap;
    context.beginPath();
    context.ellipse(guard.x, guard.y - r * 0.72, r * 0.62, r * 0.34, 0, Math.PI, 0);
    context.fill();
    context.strokeStyle = ART.outline;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = ART.capBrim;
    context.beginPath();
    context.ellipse(
      guard.x + fx * r * 0.55, guard.y - r * 0.62 + fy * r * 0.3,
      r * 0.42, r * 0.16, guard.angle, 0, Math.PI * 2,
    );
    context.fill();
    context.stroke();
    context.fillStyle = ART.gold;
    context.beginPath();
    context.arc(guard.x, guard.y - r * 0.78, 3, 0, Math.PI * 2);
    context.fill();
    slimeFace(guard.x, guard.y, r, guard.angle, { surprised: guard.alert });
    // Flashlight at the facing side.
    const lx = guard.x + fx * r * 0.95;
    const ly = guard.y + fy * r * 0.95 + r * 0.25;
    context.save();
    context.translate(lx, ly);
    context.rotate(guard.angle);
    context.fillStyle = '#3a3f52';
    roundRectPath(-3, -3.5, 11, 7, 2);
    context.fill();
    context.fillStyle = '#ffe9a8';
    context.beginPath();
    context.arc(9, 0, 3.2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    if (guard.alert) {
      const high = state.alarm >= 0.85;
      alertBubble(guard.x + r * 0.9, guard.y - r * 1.25, high ? '!' : '?', high ? PALETTE.danger : '#e8a13a');
    } else if (guard.mode === 'investigate') {
      alertBubble(guard.x + r * 0.9, guard.y - r * 1.25, '♪', '#8a6a1a');
    }
  }

  function drawCamera(state, camera) {
    const { x, y, angle } = camera;
    // Wall mount.
    context.fillStyle = '#3a3f52';
    context.fillRect(x - 5, y - 14, 10, 10);
    context.strokeStyle = ART.outline;
    context.lineWidth = 2;
    context.strokeRect(x - 5, y - 14, 10, 10);
    // Body, rotated toward facing.
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    const bodyGrad = context.createLinearGradient(-14, 0, 14, 0);
    bodyGrad.addColorStop(0, '#aebfe0');
    bodyGrad.addColorStop(1, '#6b7fa3');
    context.fillStyle = bodyGrad;
    roundRectPath(-14, -7, 26, 14, 5);
    context.fill();
    context.strokeStyle = ART.outline;
    context.lineWidth = 2.5;
    context.stroke();
    // Lens.
    context.fillStyle = '#1d2440';
    context.beginPath();
    context.arc(13, 0, 5.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#7dd7ff';
    context.beginPath();
    context.arc(14.5, -1.5, 2.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.85)';
    context.beginPath();
    context.arc(15.2, -2.2, 1, 0, Math.PI * 2);
    context.fill();
    context.restore();
    // Blinking record light (red when it sees the thief).
    const blink = camera.alert || Math.sin(state.totalTime * 4 + x * 0.05) > 0.3;
    if (blink) {
      context.fillStyle = camera.alert ? '#ff5a4e' : '#ff9a8a';
      context.beginPath();
      context.arc(x, y - 18, 3.2, 0, Math.PI * 2);
      context.fill();
    }
    context.textBaseline = 'middle';
    text('CAM', x, y + 18, 10, 'rgba(220, 232, 255, 0.8)', 'center', 'bold');
  }

  function drawPlayer(state) {
    const player = state.player;
    const m = motionOf(player, state.totalTime);
    const r = (player.sneaking ? 15 : 17);
    const squash = player.sneaking ? m.squash + 0.1 : m.squash;
    // Loot bag on the back once the gem is pocketed.
    if (state.hasLoot) {
      const bx = player.x - Math.cos(player.angle) * r * 0.9;
      const by = player.y - Math.sin(player.angle) * r * 0.9 + 3;
      context.fillStyle = ART.bag;
      context.beginPath();
      context.ellipse(bx, by, 10, 8.5, player.angle, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = ART.outline;
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = '#6f4c27';
      context.beginPath();
      context.ellipse(bx, by - 6, 5, 3, 0, 0, Math.PI * 2);
      context.fill();
      drawGem(bx, by - 1, 6);
    }
    slimeBody(player.x, player.y, r, squash, ART.thiefBody, ART.thiefShade, ART.thiefDeep);
    // Bandit mask across the eyes.
    const lookX = Math.cos(player.angle) * r * 0.14;
    const lookY = Math.sin(player.angle) * r * 0.09;
    context.save();
    context.translate(player.x + lookX, player.y - r * 0.1 + lookY);
    context.rotate(Math.sin(player.angle) * 0.15);
    context.fillStyle = ART.mask;
    roundRectPath(-r * 0.72, -r * 0.2, r * 1.44, r * 0.4, r * 0.2);
    context.fill();
    context.restore();
    slimeFace(player.x, player.y, r, player.angle, { surprised: state.alarm > 0.6, sly: state.alarm <= 0.6 });
    if (state.alarm > 0.35) sweatDrop(player.x + r * 0.95, player.y - r * 0.55, state.totalTime);
  }

  function drawField(state) {
    if (!floorCanvas) buildFloor();
    context.drawImage(floorCanvas, 0, 0);
    for (const guard of state.guards) drawGuardBeam(state, guard);
    for (const camera of state.cameras) drawCameraBeam(state, camera);
    drawExit(state);
    if (!state.hasLoot) drawLoot(state, (Math.sin(state.totalTime * 3) + 1) / 2);
    drawDecoy(state);
    for (const rect of state.cover) drawCover(rect);
    drawSmoke(state);
    for (const camera of state.cameras) drawCamera(state, camera);
    for (const guard of state.guards) drawGuard(state, guard);
    drawPlayer(state);
    if (!vignette) buildVignette();
    context.fillStyle = vignette;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function formatTime(seconds) {
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  function hudBack(x, y, w, h) {
    roundRectPath(x, y, w, h, 10);
    context.fillStyle = ART.hudBack;
    context.fill();
    context.strokeStyle = ART.hudEdge;
    context.lineWidth = 1.5;
    context.stroke();
  }

  function drawHud(state) {
    context.textBaseline = 'top';
    hudBack(14, 10, 460, 64);
    text(`Room ${state.levelIndex + 1} — ${state.levelName}`, 26, 17, 23, PALETTE.text, 'left', 'bold');
    text(state.hasLoot ? 'Gem: pocketed — reach the EXIT!' : 'Gem: on the pedestal — stand close to grab', 26, 45, 18, state.hasLoot ? ART.exitGlow : ART.gem, 'left');
    hudBack(FIELD.width - 196, 10, 182, 64);
    text(scoreLabel(state.score - state.toolCost), FIELD.width - 26, 17, 23, PALETTE.text, 'right', 'bold');
    text(formatTime(state.totalTime), FIELD.width - 26, 45, 18, PALETTE.muted, 'right');
    // Alarm meter, top centre.
    const barWidth = 230;
    const barX = (FIELD.width - barWidth) / 2;
    hudBack(barX - 44, 8, barWidth + 88, 52);
    const ex = barX - 24;
    const ey = 34;
    context.strokeStyle = PALETTE.muted;
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(ex, ey, 11, 7, 0, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = state.alarm > 0.65 ? PALETTE.danger : PALETTE.muted;
    context.beginPath();
    context.arc(ex, ey, 3.4, 0, Math.PI * 2);
    context.fill();
    text('ALARM', FIELD.width / 2, 13, 14, PALETTE.muted, 'center', 'bold');
    roundRectPath(barX, 32, barWidth, 14, 7);
    context.fillStyle = '#1a2038';
    context.fill();
    if (state.alarm > 0) {
      const fillGrad = context.createLinearGradient(barX, 0, barX + barWidth, 0);
      fillGrad.addColorStop(0, '#f2c94c');
      fillGrad.addColorStop(1, '#e5534b');
      context.save();
      roundRectPath(barX, 32, barWidth, 14, 7);
      context.clip();
      context.fillStyle = fillGrad;
      context.fillRect(barX, 32, barWidth * state.alarm, 14);
      context.restore();
    }
    roundRectPath(barX, 32, barWidth, 14, 7);
    context.strokeStyle = ART.hudEdge;
    context.lineWidth = 1.5;
    context.stroke();
    // Tools, bottom left: counts and their score cost.
    hudBack(14, FIELD.height - 56, 392, 44);
    context.textBaseline = 'middle';
    text(`Q Decoy coin ×${state.decoysLeft}  (−${TOOLS.decoyCost})`, 26, FIELD.height - 34, 17, state.decoysLeft > 0 ? PALETTE.text : PALETTE.muted, 'left');
    text(`E Smoke ×${state.smokesLeft}  (−${TOOLS.smokeCost})`, 230, FIELD.height - 34, 17, state.smokesLeft > 0 ? PALETTE.text : PALETTE.muted, 'left');
    if (state.banner > 0) {
      context.textBaseline = 'middle';
      outlineText(`Room ${state.levelIndex + 1} — ${state.levelName}`, FIELD.width / 2, FIELD.height / 2 - 120, 42, '#ffffff', 'center', 'bold');
      outlineText('Pocket the gem, reach the EXIT unseen', FIELD.width / 2, FIELD.height / 2 - 78, 22, '#ffe9a8', 'center');
    }
  }

  function drawPanel(title, lines, prompt) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(10, 12, 30, 0.45)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    roundRectPath(x + 6, y + 10, PANEL.width, height, 22);
    context.fillStyle = 'rgba(8, 10, 26, 0.5)';
    context.fill();
    const grad = context.createLinearGradient(x, y, x, y + height);
    grad.addColorStop(0, ART.panelTop);
    grad.addColorStop(1, ART.panelBottom);
    roundRectPath(x, y, PANEL.width, height, 22);
    context.fillStyle = grad;
    context.fill();
    context.strokeStyle = ART.panelEdge;
    context.lineWidth = 3;
    context.stroke();
    roundRectPath(x + 8, y + 8, PANEL.width - 16, height - 16, 16);
    context.strokeStyle = 'rgba(220, 232, 255, 0.35)';
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#ffe9a8';
    for (const [sx, sy] of [[x + 26, y + 26], [x + PANEL.width - 26, y + 26], [x + 26, y + height - 26], [x + PANEL.width - 26, y + height - 26]]) {
      context.beginPath();
      context.moveTo(sx, sy - 8);
      context.lineTo(sx + 2.4, sy);
      context.lineTo(sx, sy + 8);
      context.lineTo(sx - 2.4, sy);
      context.closePath();
      context.fill();
    }
    context.textBaseline = 'alphabetic';
    outlineText(title, FIELD.width / 2, y + 84, 52, '#ffffff', 'center', 'bold');
    context.strokeStyle = 'rgba(255, 233, 168, 0.7)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(FIELD.width / 2 - 130, y + 104);
    context.lineTo(FIELD.width / 2 - 14, y + 104);
    context.moveTo(FIELD.width / 2 + 14, y + 104);
    context.lineTo(FIELD.width / 2 + 130, y + 104);
    context.stroke();
    context.fillStyle = '#ffe9a8';
    context.beginPath();
    context.moveTo(FIELD.width / 2, y + 96);
    context.lineTo(FIELD.width / 2 + 7, y + 104);
    context.lineTo(FIELD.width / 2, y + 112);
    context.lineTo(FIELD.width / 2 - 7, y + 104);
    context.closePath();
    context.fill();
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 21, '#dbe4ff', 'center');
    }
    setFont(23, 'bold');
    const pw = context.measureText(prompt).width + 44;
    roundRectPath(FIELD.width / 2 - pw / 2, y + height - 62, pw, 38, 19);
    context.fillStyle = 'rgba(242, 201, 76, 0.16)';
    context.fill();
    context.strokeStyle = 'rgba(242, 201, 76, 0.65)';
    context.lineWidth = 1.5;
    context.stroke();
    text(prompt, FIELD.width / 2, y + height - 34, 23, ART.gold, 'center', 'bold');
  }

  const TITLE_LINES = [
    'Sneak past the guard slimes and cameras, pocket the gem, escape.',
    'Stay out of the light beams — cases and walls block sight.',
    'Move: WASD / arrows / mouse. Sneak: Shift. Q: decoy. E: smoke.',
    '',
  ];
  const PAUSED_LINES = ['The guards will wait for you.'];
  const CAUGHT_LINES = ['', ''];
  const WIN_LINES = ['', '', ''];

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawField(state);
    if (screen === SCREEN_TITLE) {
      TITLE_LINES[3] = bestLabel(best);
      drawPanel('Slime Heist', TITLE_LINES, 'Press Space or click to start');
      return;
    }
    drawHud(state);
    if (screen === SCREEN_PAUSED) drawPanel('Paused', PAUSED_LINES, 'Press P to resume');
    else if (screen === SCREEN_CAUGHT) {
      CAUGHT_LINES[0] = 'The alarm tripped. The gem stays in its case… this time.';
      CAUGHT_LINES[1] = finalLabel(state.score - state.toolCost);
      drawPanel('Caught!', CAUGHT_LINES, 'Press Space or click to try again');
    } else if (screen === SCREEN_WIN) {
      WIN_LINES[0] = 'Every gem pocketed, every guard none the wiser.';
      WIN_LINES[1] = `${finalLabel(state.score - state.toolCost)}   Time ${formatTime(state.totalTime)}`;
      WIN_LINES[2] = bestLabel(best);
      drawPanel('Clean Getaway!', WIN_LINES, 'Press Space or click to play again');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toLogical };
}

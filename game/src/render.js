// Slime Heist renderer: game state in, pixels out. Nothing here decides
// anything about the rules — it only paints what the world already computed.
//
// The picture is an anime museum at night, drawn entirely with canvas
// shapes: veined marble tiles, brick walls, glass exhibit cases, wooden
// crates, a glowing getaway door, and soft slime characters — a pink thief
// in a bandit mask, indigo guards with caps and flashlights. Watcher vision
// is drawn as an actual light beam (gradient fan, cut off where cover
// blocks it), so the player sees exactly the ground that is dangerous.

import { CAMERA, FIELD, FONT, GUARD, PALETTE, TOOLS } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_CAUGHT = 'caught';
export const SCREEN_WIN = 'win';

// Colours for the night-museum palette. Beam colours are open-ended rgba
// prefixes so an alpha can be appended per gradient stop.
const INK = '#241f3d';
const FLOOR_TONES = ['#4a5578', '#414d6e'];
const GROUT = '#2c3552';
const VEIN = 'rgba(190, 205, 255, 0.16)';
const TILE_LIGHT = 'rgba(205, 220, 255, 0.12)';
const ROPE = 'rgba(255, 125, 156, 0.35)';
const BRICK = { top: '#8595bd', mid: '#5d6d99', low: '#46537a', line: '#39466b' };
const WOOD = { light: '#c99a63', mid: '#b0824f', dark: '#8a6136', grain: 'rgba(111, 76, 39, 0.55)' };
const CASE = { baseTop: '#6b4a8a', baseLow: '#4e3466', glass: 'rgba(160, 220, 255, 0.30)', shine: 'rgba(255, 255, 255, 0.45)' };
const THIEF = { body: '#ff9ec4', shade: '#f06fa8', edge: '#c94f86', mask: '#2b2440', bag: '#8a6136' };
const GUARD_ART = { body: '#7a6fd0', shade: '#57499f', edge: '#41357c', cap: '#2e3a67', brim: '#232c50' };
const GOLD = '#f2c94c';
const EYE = '#2b2440';
const BLUSH = 'rgba(255, 130, 160, 0.55)';
const GEM = { hi: '#d8fff4', mid: '#5ef2d6', low: '#25b79a' };
const EXIT_GREEN = '#4fe3a5';
const PANEL = { top: '#3a4470', low: '#252c4d', edge: '#8fa3d9' };
const HUD = { fill: 'rgba(24, 28, 52, 0.72)', edge: 'rgba(160, 180, 235, 0.45)' };
const BEAM = { lamp: 'rgba(255, 226, 140, ', lampHot: 'rgba(255, 110, 100, ', cam: 'rgba(140, 210, 255, ', camHot: 'rgba(255, 110, 100, ' };
const SHADOW = 'rgba(12, 14, 32, 0.35)';

const TILE = 80;
const RAYS = 30;
const TAU = Math.PI * 2;

// Stable pseudo-random in [0,1) from two integers — textures must not
// shimmer between frames, so nothing here uses Math.random.
function scramble(a, b) {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// How far a ray from (x,y) along (dx,dy) travels before entering `rect`
// (Infinity when it misses). Used to clip light beams at cover.
function rayHit(x, y, dx, dy, rect) {
  let near = 0;
  let far = Infinity;
  const slabs = [
    [x, dx, rect.x, rect.x + rect.width],
    [y, dy, rect.y, rect.y + rect.height],
  ];
  for (const [origin, dir, lo, hi] of slabs) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < lo || origin > hi) return Infinity;
    } else {
      let t0 = (lo - origin) / dir;
      let t1 = (hi - origin) / dir;
      if (t0 > t1) [t0, t1] = [t1, t0];
      near = Math.max(near, t0);
      far = Math.min(far, t1);
    }
  }
  return far >= near ? near : Infinity;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, ox: 0, oy: 0 };
  const wiggle = new WeakMap(); // per-slime bounce bookkeeping
  let floor = null;
  let shade = null; // vignette gradient, built once

  // ---- sizing -----------------------------------------------------------
  function fit() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    view.scale = Math.min(canvas.width / FIELD.width, canvas.height / FIELD.height);
    view.ox = (canvas.width - FIELD.width * view.scale) / 2;
    view.oy = (canvas.height - FIELD.height * view.scale) / 2;
  }

  function toLogical(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * canvas.width;
    const py = ((clientY - box.top) / box.height) * canvas.height;
    return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
  }

  // ---- tiny drawing helpers ---------------------------------------------
  function font(px, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`;
  }

  function label(str, x, y, px, colour, align = 'left', bold = false) {
    font(px, bold);
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
  }

  function bigLabel(str, x, y, px, colour, align = 'center') {
    font(px, true);
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(3, px / 7);
    ctx.strokeText(str, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(str, x, y);
  }

  function rounded(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function ellipse(x, y, rx, ry, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  }

  // Squash-and-stretch state for a slime: it bounces while moving and
  // breathes gently while still. Keyed by the entity object itself.
  function bounceOf(entity, now) {
    let m = wiggle.get(entity);
    if (!m) {
      m = { px: entity.x, py: entity.y, phase: 0 };
      wiggle.set(entity, m);
    }
    const travelled = Math.hypot(entity.x - m.px, entity.y - m.py);
    m.px = entity.x;
    m.py = entity.y;
    if (travelled > 0.05) m.phase += travelled * 0.32;
    const moving = travelled > 0.05;
    const squash = moving
      ? Math.sin(m.phase) * 0.09
      : Math.sin(now * 2.4 + entity.x * 0.02) * 0.035;
    return squash;
  }

  // ---- the floor, painted once onto its own canvas ----------------------
  function paintFloor() {
    floor = document.createElement('canvas');
    floor.width = FIELD.width;
    floor.height = FIELD.height;
    const g = floor.getContext('2d');
    g.fillStyle = FLOOR_TONES[0];
    g.fillRect(0, 0, FIELD.width, FIELD.height);

    for (let ty = 0; ty * TILE < FIELD.height; ty += 1) {
      for (let tx = 0; tx * TILE < FIELD.width; tx += 1) {
        const x = tx * TILE;
        const y = ty * TILE;
        g.fillStyle = FLOOR_TONES[(tx + ty) % 2];
        g.fillRect(x, y, TILE, TILE);
        if (scramble(tx, ty) > 0.7) {
          g.fillStyle = 'rgba(255, 255, 255, 0.05)';
          g.fillRect(x, y, TILE, TILE);
        }
        // a cel-shaded glint along the top and left edges
        g.fillStyle = TILE_LIGHT;
        g.fillRect(x, y, TILE, 4);
        g.fillRect(x, y, 4, TILE);
        // two wandering marble veins
        g.strokeStyle = VEIN;
        g.lineWidth = 2;
        for (let v = 0; v < 2; v += 1) {
          const vy = y + 14 + scramble(tx * 3 + v, ty * 7) * (TILE - 28);
          g.beginPath();
          g.moveTo(x + 4, vy);
          g.bezierCurveTo(
            x + TILE * 0.35, vy - 6 + scramble(tx, ty + v) * 12,
            x + TILE * 0.65, vy + 6 - scramble(tx + v, ty) * 12,
            x + TILE - 4, vy + (scramble(tx * 9, ty * 5 + v) - 0.5) * 14,
          );
          g.stroke();
        }
        // stone speckles
        g.fillStyle = 'rgba(20, 26, 48, 0.25)';
        for (let s = 0; s < 4; s += 1) {
          g.fillRect(
            x + 3 + scramble(tx * 7 + s, ty * 3) * (TILE - 6),
            y + 3 + scramble(tx * 5, ty * 11 + s) * (TILE - 6),
            3, 2,
          );
        }
      }
    }

    // grout between the tiles
    g.strokeStyle = GROUT;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= FIELD.width; x += TILE) { g.moveTo(x, 0); g.lineTo(x, FIELD.height); }
    for (let y = 0; y <= FIELD.height; y += TILE) { g.moveTo(0, y); g.lineTo(FIELD.width, y); }
    g.stroke();

    // worn patches
    for (let i = 0; i < 12; i += 1) {
      const sx = scramble(i, 31) * FIELD.width;
      const sy = scramble(17, i) * FIELD.height;
      const r = 30 + scramble(i, 7) * 70;
      const grad = g.createRadialGradient(sx, sy, 4, sx, sy, r);
      grad.addColorStop(0, 'rgba(14, 18, 38, 0.20)');
      grad.addColorStop(1, 'rgba(14, 18, 38, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sx, sy, r, 0, TAU);
      g.fill();
    }

    // the velvet-rope line painted across the gallery
    g.strokeStyle = ROPE;
    g.lineWidth = 5;
    g.setLineDash([26, 20]);
    g.beginPath();
    g.moveTo(FIELD.wall + 30, FIELD.height / 2);
    g.lineTo(FIELD.width - FIELD.wall - 30, FIELD.height / 2);
    g.stroke();
    g.setLineDash([]);
  }

  function vignette() {
    if (!shade) {
      shade = ctx.createRadialGradient(
        FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.42,
        FIELD.width / 2, FIELD.height / 2, FIELD.width * 0.72,
      );
      shade.addColorStop(0, 'rgba(10, 10, 30, 0)');
      shade.addColorStop(1, 'rgba(10, 10, 30, 0.38)');
    }
    return shade;
  }

  // ---- light beams --------------------------------------------------------
  // A fan of rays from the watcher, each stopped by the first cover it hits.
  function fanPoints(state, ox, oy, heading, half, range) {
    const pts = [];
    for (let i = 0; i <= RAYS; i += 1) {
      const a = heading - half + (2 * half * i) / RAYS;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let reach = range;
      for (const rect of state.cover) {
        const hit = rayHit(ox, oy, dx, dy, rect);
        if (hit < reach) reach = hit;
      }
      pts.push([ox + dx * reach, oy + dy * reach]);
    }
    return pts;
  }

  function beam(state, ox, oy, heading, half, range, tint) {
    const pts = fanPoints(state, ox, oy, heading, half, range);
    const trace = (shrink) => {
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      for (const [px, py] of pts) ctx.lineTo(ox + (px - ox) * shrink, oy + (py - oy) * shrink);
      ctx.closePath();
    };
    trace(1);
    let grad = ctx.createRadialGradient(ox, oy, 6, ox, oy, range);
    grad.addColorStop(0, `${tint}0.50)`);
    grad.addColorStop(0.55, `${tint}0.26)`);
    grad.addColorStop(1, `${tint}0.02)`);
    ctx.fillStyle = grad;
    ctx.fill();
    // hot core near the lamp itself
    trace(0.55);
    grad = ctx.createRadialGradient(ox, oy, 4, ox, oy, range * 0.55);
    grad.addColorStop(0, `${tint}0.55)`);
    grad.addColorStop(1, `${tint}0.05)`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ---- cover --------------------------------------------------------------
  function dropShadow(rect) {
    ctx.fillStyle = SHADOW;
    ctx.fillRect(rect.x + 5, rect.y + 7, rect.width, rect.height);
  }

  function outlineRect(rect, width = 2.5) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = width;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  }

  function paintWall(rect) {
    dropShadow(rect);
    const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
    grad.addColorStop(0, BRICK.top);
    grad.addColorStop(0.18, BRICK.mid);
    grad.addColorStop(1, BRICK.low);
    ctx.fillStyle = grad;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    const course = 16;
    const brickW = 34;
    ctx.strokeStyle = BRICK.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = rect.y + course; y < rect.y + rect.height; y += course) {
      ctx.moveTo(rect.x, y);
      ctx.lineTo(rect.x + rect.width, y);
    }
    ctx.stroke();
    ctx.beginPath();
    let row = 0;
    for (let y = rect.y; y < rect.y + rect.height; y += course) {
      const offset = row % 2 ? brickW / 2 : 0;
      for (let x = rect.x + offset; x < rect.x + rect.width; x += brickW) {
        if (x > rect.x) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, Math.min(y + course, rect.y + rect.height));
        }
      }
      row += 1;
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(210, 225, 255, 0.35)';
    ctx.fillRect(rect.x, rect.y, rect.width, 4);
    outlineRect(rect);
  }

  function paintCase(rect) {
    dropShadow(rect);
    const { x, y, width: w, height: h } = rect;
    // plinth
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, CASE.baseTop);
    grad.addColorStop(1, CASE.baseLow);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + h * 0.62, w, h * 0.38);
    // glass hood
    ctx.fillStyle = CASE.glass;
    ctx.fillRect(x, y, w, h * 0.66);
    // the little golden vase inside
    ctx.fillStyle = 'rgba(242, 201, 76, 0.85)';
    ellipse(x + w / 2, y + h * 0.42, w * 0.13, h * 0.2);
    ctx.fill();
    ctx.fillRect(x + w / 2 - w * 0.06, y + h * 0.14, w * 0.12, h * 0.12);
    // reflections streaking down the glass
    ctx.strokeStyle = CASE.shine;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.18, y + h * 0.6);
    ctx.lineTo(x + w * 0.42, y + 5);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + h * 0.6);
    ctx.lineTo(x + w * 0.64, y + 5);
    ctx.stroke();
    ctx.strokeStyle = CASE.baseLow;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    outlineRect(rect);
  }

  function paintCrate(rect) {
    dropShadow(rect);
    const { x, y, width: w, height: h } = rect;
    ctx.fillStyle = WOOD.mid;
    ctx.fillRect(x, y, w, h);
    const planks = 3;
    const ph = h / planks;
    for (let i = 0; i < planks; i += 1) {
      const py = y + i * ph;
      ctx.fillStyle = i % 2 ? WOOD.mid : WOOD.light;
      ctx.fillRect(x + 3, py + 3, w - 6, ph - 6);
      ctx.strokeStyle = WOOD.grain;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const frac of [0.35, 0.65]) {
        const gy = py + ph * frac;
        ctx.moveTo(x + 8, gy);
        ctx.bezierCurveTo(x + w * 0.35, gy - 2, x + w * 0.65, gy + 2, x + w - 8, gy);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = WOOD.dark;
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + h - 5);
    ctx.lineTo(x + w - 5, y + 5);
    ctx.stroke();
    ctx.fillStyle = '#4a3319';
    for (const [nx, ny] of [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8]]) {
      ctx.beginPath();
      ctx.arc(nx, ny, 2.4, 0, TAU);
      ctx.fill();
    }
    outlineRect(rect);
  }

  function paintCover(rect) {
    if (rect.kind === 'case') paintCase(rect);
    else if (rect.kind === 'crate') paintCrate(rect);
    else paintWall(rect);
  }

  // ---- the getaway door ---------------------------------------------------
  function paintExit(state) {
    const door = state.exit;
    const open = state.hasLoot;
    const pulse = 0.75 + 0.25 * Math.sin(state.totalTime * 3.2);
    if (open) {
      // green light spilling out of the doorway
      const spill = ctx.createLinearGradient(door.x, 0, door.x - 90, 0);
      spill.addColorStop(0, `rgba(79, 227, 165, ${0.28 * pulse})`);
      spill.addColorStop(1, 'rgba(79, 227, 165, 0)');
      ctx.fillStyle = spill;
      ctx.beginPath();
      ctx.moveTo(door.x, door.y + 6);
      ctx.lineTo(door.x - 90, door.y - 14);
      ctx.lineTo(door.x - 90, door.y + door.height + 14);
      ctx.lineTo(door.x, door.y + door.height - 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#1d2b26';
    ctx.fillRect(door.x - 4, door.y - 4, door.width + 8, door.height + 8);
    const grad = ctx.createLinearGradient(door.x, door.y, door.x, door.y + door.height);
    grad.addColorStop(0, open ? '#57d9a3' : '#5d7268');
    grad.addColorStop(1, open ? '#2f9d72' : '#42534b');
    ctx.fillStyle = grad;
    ctx.fillRect(door.x, door.y, door.width, door.height);
    ctx.strokeStyle = 'rgba(20, 40, 32, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(door.x + 7, door.y + 26, door.width - 14, door.height - 36);
    // handle
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.arc(door.x + 12, door.y + door.height / 2 + 12, 3.5, 0, TAU);
    ctx.fill();
    // the EXIT sign (glowing once the gem is pocketed)
    ctx.save();
    if (open) {
      ctx.shadowColor = EXIT_GREEN;
      ctx.shadowBlur = 16 * pulse;
    }
    rounded(door.x + 4, door.y + 4, door.width - 8, 22, 6);
    ctx.fillStyle = open ? '#eafff5' : '#9fb3a8';
    ctx.fill();
    ctx.restore();
    ctx.textBaseline = 'middle';
    label('EXIT', door.x + door.width / 2, door.y + 16, 15, open ? '#14724e' : '#3d4f46', 'center', true);
    if (open) {
      label('GO!', door.x + door.width / 2, door.y + door.height - 12, 14, '#eafff5', 'center', true);
    } else {
      // padlock
      const lx = door.x + door.width / 2;
      const ly = door.y + door.height - 16;
      ctx.strokeStyle = '#d7e6de';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(lx, ly - 4, 5, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = '#d7e6de';
      rounded(lx - 7, ly - 4, 14, 11, 3);
      ctx.fill();
      ctx.fillStyle = '#42534b';
      ctx.beginPath();
      ctx.arc(lx, ly + 1, 2.2, 0, TAU);
      ctx.fill();
    }
  }

  // ---- the gem and its pedestal -------------------------------------------
  function paintGem(cx, cy, s) {
    // table (top face)
    ctx.fillStyle = GEM.hi;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.25);
    ctx.lineTo(cx - s * 0.55, cy - s * 0.8);
    ctx.lineTo(cx + s * 0.55, cy - s * 0.8);
    ctx.lineTo(cx + s, cy - s * 0.25);
    ctx.closePath();
    ctx.fill();
    // pavilion, lit half then shaded half
    ctx.fillStyle = GEM.mid;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.25);
    ctx.lineTo(cx + s, cy - s * 0.25);
    ctx.lineTo(cx, cy + s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = GEM.low;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.25);
    ctx.lineTo(cx + s, cy - s * 0.25);
    ctx.lineTo(cx, cy + s);
    ctx.closePath();
    ctx.fill();
    // facet edges
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.25);
    ctx.lineTo(cx - s * 0.55, cy - s * 0.8);
    ctx.lineTo(cx + s * 0.55, cy - s * 0.8);
    ctx.lineTo(cx + s, cy - s * 0.25);
    ctx.lineTo(cx, cy + s);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.25);
    ctx.lineTo(cx + s, cy - s * 0.25);
    ctx.moveTo(cx, cy - s * 0.8);
    ctx.lineTo(cx, cy - s * 0.25);
    ctx.stroke();
    // one bright sparkle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.35, cy - s * 1.05);
    ctx.lineTo(cx - s * 0.22, cy - s * 0.6);
    ctx.lineTo(cx - s * 0.35, cy - s * 0.25);
    ctx.lineTo(cx - s * 0.48, cy - s * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  function paintLoot(state) {
    const p = state.lootPos;
    const pulse = (Math.sin(state.totalTime * 3) + 1) / 2;
    // halo
    const halo = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 38 + pulse * 9);
    halo.addColorStop(0, 'rgba(140, 255, 230, 0.5)');
    halo.addColorStop(1, 'rgba(140, 255, 230, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 38 + pulse * 9, 0, TAU);
    ctx.fill();
    // pedestal shadow + stand
    ctx.fillStyle = SHADOW;
    ellipse(p.x, p.y + 20, 24, 7);
    ctx.fill();
    const grad = ctx.createLinearGradient(p.x, p.y + 4, p.x, p.y + 20);
    grad.addColorStop(0, '#8fa3d9');
    grad.addColorStop(1, '#46537a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(p.x - 13, p.y + 18);
    ctx.lineTo(p.x - 9, p.y + 4);
    ctx.lineTo(p.x + 9, p.y + 4);
    ctx.lineTo(p.x + 13, p.y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    paintGem(p.x, p.y - 6 - pulse * 2, 15);
    // sparkles drifting around it
    ctx.fillStyle = GEM.hi;
    for (let i = 0; i < 3; i += 1) {
      const a = state.totalTime * 1.6 + i * 2.1;
      const sx = p.x + Math.cos(a) * 27;
      const sy = p.y - 10 + Math.sin(a) * 13;
      const r = 3 + Math.sin(state.totalTime * 4 + i) * 1.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r * 1.8);
      ctx.lineTo(sx + r * 0.5, sy);
      ctx.lineTo(sx, sy + r * 1.8);
      ctx.lineTo(sx - r * 0.5, sy);
      ctx.closePath();
      ctx.fill();
    }
    // grab-progress ring while the thief stands at the pedestal
    if (state.grabProgress > 0) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 4, 30, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = GEM.mid;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 4, 30, -Math.PI / 2, -Math.PI / 2 + state.grabProgress * TAU);
      ctx.stroke();
      ctx.textBaseline = 'middle';
      label('GRABBING…', p.x, p.y - 48, 14, GEM.hi, 'center', true);
    }
  }

  // ---- tools on the floor ---------------------------------------------------
  function paintSmoke(state) {
    for (const puff of state.smokes) {
      const fade = Math.min(1, puff.timer / 1.2);
      for (let i = 0; i < 5; i += 1) {
        const a = i * 1.7 + puff.x * 0.01;
        const ox = Math.cos(a) * TOOLS.smokeRadius * 0.4;
        const oy = Math.sin(a) * TOOLS.smokeRadius * 0.3;
        const r = TOOLS.smokeRadius * (0.55 + scramble(i, Math.floor(puff.x)) * 0.3);
        const grad = ctx.createRadialGradient(puff.x + ox, puff.y + oy, 2, puff.x + ox, puff.y + oy, r);
        grad.addColorStop(0, `rgba(220, 226, 240, ${0.55 * fade})`);
        grad.addColorStop(1, 'rgba(220, 226, 240, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(puff.x + ox, puff.y + oy, r, 0, TAU);
        ctx.fill();
      }
    }
  }

  function paintDecoy(state) {
    const d = state.decoy;
    if (!d) return;
    const pulse = (Math.sin(state.totalTime * 8) + 1) / 2;
    ctx.strokeStyle = `rgba(242, 201, 76, ${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 12 + pulse * 6, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ellipse(d.x, d.y, 8, 5.5);
    ctx.fill();
    ctx.strokeStyle = '#8a6a1a';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    label('♪', d.x + 12, d.y - 12, 18, GOLD, 'left', true);
  }

  // ---- slimes ---------------------------------------------------------------
  // One dome-shaped body with a cel-shaded belly, a gloss highlight and an
  // outline. `squash` stretches it sideways as it bounces.
  function slimeDome(x, y, r, squash, art) {
    const w = r * (1 + squash);
    const h = r * (1 - squash * 0.7);
    ctx.fillStyle = SHADOW;
    ellipse(x, y + h * 0.82, w * 0.95, h * 0.3);
    ctx.fill();

    const dome = () => {
      ctx.beginPath();
      ctx.moveTo(x - w, y + h * 0.55);
      ctx.bezierCurveTo(x - w, y - h * 0.55, x - w * 0.45, y - h, x, y - h);
      ctx.bezierCurveTo(x + w * 0.45, y - h, x + w, y - h * 0.55, x + w, y + h * 0.55);
      ctx.bezierCurveTo(x + w, y + h * 0.85, x + w * 0.5, y + h * 0.95, x, y + h * 0.95);
      ctx.bezierCurveTo(x - w * 0.5, y + h * 0.95, x - w, y + h * 0.85, x - w, y + h * 0.55);
      ctx.closePath();
    };
    const grad = ctx.createLinearGradient(x, y - h, x, y + h);
    grad.addColorStop(0, art.body);
    grad.addColorStop(0.62, art.body);
    grad.addColorStop(1, art.shade);
    dome();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = art.shade;
    ellipse(x, y + h * 1.15, w * 1.05, h * 0.55);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
    ellipse(x - w * 0.35, y - h * 0.45, w * 0.34, h * 0.2, -0.5);
    ctx.fill();
    ctx.restore();
    dome();
    ctx.strokeStyle = art.edge;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ellipse(x - w * 0.38, y - h * 0.52, w * 0.2, h * 0.11, -0.6);
    ctx.fill();
  }

  // Eyes that glance toward the facing, a mouth, and blush cheeks.
  // mood: 'calm' | 'sly' | 'startled'
  function slimeFace(x, y, r, heading, mood) {
    const gx = Math.cos(heading) * r * 0.16;
    const gy = Math.sin(heading) * r * 0.1;
    const eyeY = y - r * 0.08 + gy;
    for (const side of [-1, 1]) {
      const ex = x + side * r * 0.34 + gx;
      ctx.fillStyle = EYE;
      ellipse(ex, eyeY, r * 0.11, r * 0.17);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex - r * 0.03, eyeY - r * 0.06, r * 0.045, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = EYE;
    ctx.lineWidth = 2;
    if (mood === 'startled') {
      ctx.fillStyle = EYE;
      ctx.beginPath();
      ctx.arc(x + gx, y + r * 0.24, r * 0.1, 0, TAU);
      ctx.fill();
    } else if (mood === 'sly') {
      ctx.beginPath();
      ctx.arc(x + gx + r * 0.06, y + r * 0.1, r * 0.16, 0.15 * Math.PI, 0.62 * Math.PI);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x + gx, y + r * 0.14, r * 0.14, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
    }
    ctx.fillStyle = BLUSH;
    for (const side of [-1, 1]) {
      ellipse(x + side * r * 0.58 + gx, y + r * 0.16, r * 0.16, r * 0.09);
      ctx.fill();
    }
  }

  // Starburst badge with a mark in it ("?", "!", "♪") above a watcher.
  function badge(x, y, mark, colour) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    for (let i = 0; i < 20; i += 1) {
      const a = (i / 20) * TAU;
      const rr = i % 2 === 0 ? 15 : 10.5;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff7d6';
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    label(mark, 0, 1, 19, colour, 'center', true);
    ctx.restore();
  }

  function sweat(x, y, now) {
    const bob = Math.sin(now * 6) * 2;
    ctx.fillStyle = '#9fdcff';
    ctx.strokeStyle = '#4d9fd6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 8 + bob);
    ctx.bezierCurveTo(x + 5, y + bob, x + 5.5, y + 4 + bob, x, y + 6 + bob);
    ctx.bezierCurveTo(x - 5.5, y + 4 + bob, x - 5, y + bob, x, y - 8 + bob);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x - 1.5, y + 1 + bob, 1.4, 0, TAU);
    ctx.fill();
  }

  function paintGuard(state, guard) {
    const r = GUARD.radius + 3;
    slimeDome(guard.x, guard.y, r, bounceOf(guard, state.totalTime), GUARD_ART);
    const fx = Math.cos(guard.angle);
    const fy = Math.sin(guard.angle);
    // cap with the brim pointing the way it faces
    ctx.fillStyle = GUARD_ART.cap;
    ctx.beginPath();
    ctx.ellipse(guard.x, guard.y - r * 0.72, r * 0.62, r * 0.34, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = GUARD_ART.brim;
    ellipse(guard.x + fx * r * 0.55, guard.y - r * 0.62 + fy * r * 0.3, r * 0.42, r * 0.16, guard.angle);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(guard.x, guard.y - r * 0.78, 3, 0, TAU);
    ctx.fill();
    slimeFace(guard.x, guard.y, r, guard.angle, guard.alert ? 'startled' : 'calm');
    // flashlight held out front
    ctx.save();
    ctx.translate(guard.x + fx * r * 0.95, guard.y + fy * r * 0.95 + r * 0.25);
    ctx.rotate(guard.angle);
    ctx.fillStyle = '#3a3f52';
    rounded(-3, -3.5, 11, 7, 2);
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.arc(9, 0, 3.2, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (guard.alert) {
      const hot = state.alarm >= 0.85;
      badge(guard.x + r * 0.9, guard.y - r * 1.25, hot ? '!' : '?', hot ? PALETTE.danger : '#e8a13a');
    } else if (guard.mode === 'investigate') {
      badge(guard.x + r * 0.9, guard.y - r * 1.25, '♪', '#8a6a1a');
    }
  }

  function paintCamera(state, camera) {
    const { x, y, angle } = camera;
    // wall bracket
    ctx.fillStyle = '#3a3f52';
    ctx.fillRect(x - 5, y - 14, 10, 10);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 5, y - 14, 10, 10);
    // body swung toward its facing
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(-14, 0, 14, 0);
    grad.addColorStop(0, '#aebfe0');
    grad.addColorStop(1, '#6b7fa3');
    ctx.fillStyle = grad;
    rounded(-14, -7, 26, 14, 5);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#1d2440';
    ctx.beginPath();
    ctx.arc(13, 0, 5.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7dd7ff';
    ctx.beginPath();
    ctx.arc(14.5, -1.5, 2.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(15.2, -2.2, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    // recording light: blinks idle, burns red on the thief
    if (camera.alert || Math.sin(state.totalTime * 4 + x * 0.05) > 0.3) {
      ctx.fillStyle = camera.alert ? '#ff5a4e' : '#ff9a8a';
      ctx.beginPath();
      ctx.arc(x, y - 18, 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.textBaseline = 'middle';
    label('CAM', x, y + 18, 10, 'rgba(220, 232, 255, 0.8)', 'center', true);
  }

  function paintThief(state) {
    const thief = state.player;
    const r = thief.sneaking ? 15 : 17;
    const squash = bounceOf(thief, state.totalTime) + (thief.sneaking ? 0.1 : 0);
    // loot sack riding behind once the gem is pocketed
    if (state.hasLoot) {
      const bx = thief.x - Math.cos(thief.angle) * r * 0.9;
      const by = thief.y - Math.sin(thief.angle) * r * 0.9 + 3;
      ctx.fillStyle = THIEF.bag;
      ellipse(bx, by, 10, 8.5, thief.angle);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#6f4c27';
      ellipse(bx, by - 6, 5, 3);
      ctx.fill();
      paintGem(bx, by - 1, 6);
    }
    slimeDome(thief.x, thief.y, r, squash, THIEF);
    // bandit mask across the eyes
    const gx = Math.cos(thief.angle) * r * 0.14;
    const gy = Math.sin(thief.angle) * r * 0.09;
    ctx.save();
    ctx.translate(thief.x + gx, thief.y - r * 0.1 + gy);
    ctx.rotate(Math.sin(thief.angle) * 0.15);
    ctx.fillStyle = THIEF.mask;
    rounded(-r * 0.72, -r * 0.2, r * 1.44, r * 0.4, r * 0.2);
    ctx.fill();
    ctx.restore();
    slimeFace(thief.x, thief.y, r, thief.angle, state.alarm > 0.6 ? 'startled' : 'sly');
    if (state.alarm > 0.35) sweat(thief.x + r * 0.95, thief.y - r * 0.55, state.totalTime);
  }

  // ---- one frame --------------------------------------------------------------
  function paintField(state) {
    if (!floor) paintFloor();
    ctx.drawImage(floor, 0, 0);
    for (const guard of state.guards) {
      beam(state, guard.x, guard.y, guard.angle, GUARD.viewHalfAngle, GUARD.viewRange, guard.alert ? BEAM.lampHot : BEAM.lamp);
    }
    for (const camera of state.cameras) {
      beam(state, camera.x, camera.y, camera.angle, CAMERA.viewHalfAngle, CAMERA.viewRange, camera.alert ? BEAM.camHot : BEAM.cam);
    }
    paintExit(state);
    if (!state.hasLoot) paintLoot(state);
    paintDecoy(state);
    for (const rect of state.cover) paintCover(rect);
    paintSmoke(state);
    for (const camera of state.cameras) paintCamera(state, camera);
    for (const guard of state.guards) paintGuard(state, guard);
    paintThief(state);
    ctx.fillStyle = vignette();
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function clock(seconds) {
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  function hudPanel(x, y, w, h) {
    rounded(x, y, w, h, 10);
    ctx.fillStyle = HUD.fill;
    ctx.fill();
    ctx.strokeStyle = HUD.edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function paintHud(state) {
    ctx.textBaseline = 'top';
    hudPanel(14, 10, 460, 64);
    label(`Room ${state.levelIndex + 1} — ${state.levelName}`, 26, 17, 23, PALETTE.text, 'left', true);
    label(
      state.hasLoot ? 'Gem: pocketed — reach the EXIT!' : 'Gem: on the pedestal — stand close to grab',
      26, 45, 18, state.hasLoot ? EXIT_GREEN : GEM.mid,
    );
    hudPanel(FIELD.width - 196, 10, 182, 64);
    label(`Score ${state.score - state.toolCost}`, FIELD.width - 26, 17, 23, PALETTE.text, 'right', true);
    label(clock(state.totalTime), FIELD.width - 26, 45, 18, PALETTE.muted, 'right');

    // alarm meter across the top centre
    const barW = 230;
    const barX = (FIELD.width - barW) / 2;
    hudPanel(barX - 44, 8, barW + 88, 52);
    const ex = barX - 24;
    const ey = 34;
    ctx.strokeStyle = PALETTE.muted;
    ctx.lineWidth = 2;
    ellipse(ex, ey, 11, 7);
    ctx.stroke();
    ctx.fillStyle = state.alarm > 0.65 ? PALETTE.danger : PALETTE.muted;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.4, 0, TAU);
    ctx.fill();
    label('ALARM', FIELD.width / 2, 13, 14, PALETTE.muted, 'center', true);
    rounded(barX, 32, barW, 14, 7);
    ctx.fillStyle = '#1a2038';
    ctx.fill();
    if (state.alarm > 0) {
      const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      grad.addColorStop(0, GOLD);
      grad.addColorStop(1, PALETTE.danger);
      ctx.save();
      rounded(barX, 32, barW, 14, 7);
      ctx.clip();
      ctx.fillStyle = grad;
      ctx.fillRect(barX, 32, barW * state.alarm, 14);
      ctx.restore();
    }
    rounded(barX, 32, barW, 14, 7);
    ctx.strokeStyle = HUD.edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // remaining tools, bottom left
    hudPanel(14, FIELD.height - 56, 392, 44);
    ctx.textBaseline = 'middle';
    label(`Q Decoy coin ×${state.decoysLeft}  (−${TOOLS.decoyCost})`, 26, FIELD.height - 34, 17, state.decoysLeft > 0 ? PALETTE.text : PALETTE.muted);
    label(`E Smoke ×${state.smokesLeft}  (−${TOOLS.smokeCost})`, 230, FIELD.height - 34, 17, state.smokesLeft > 0 ? PALETTE.text : PALETTE.muted);

    if (state.banner > 0) {
      ctx.textBaseline = 'middle';
      bigLabel(`Room ${state.levelIndex + 1} — ${state.levelName}`, FIELD.width / 2, FIELD.height / 2 - 120, 42, '#ffffff');
      bigLabel('Pocket the gem, reach the EXIT unseen', FIELD.width / 2, FIELD.height / 2 - 78, 22, '#ffe9a8');
    }
  }

  function paintPanel(title, lines, prompt) {
    const lineH = 34;
    const height = 150 + lines.length * lineH + 78;
    const width = 700;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    ctx.fillStyle = 'rgba(10, 12, 30, 0.45)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    rounded(x + 6, y + 10, width, height, 22);
    ctx.fillStyle = 'rgba(8, 10, 26, 0.5)';
    ctx.fill();
    const grad = ctx.createLinearGradient(x, y, x, y + height);
    grad.addColorStop(0, PANEL.top);
    grad.addColorStop(1, PANEL.low);
    rounded(x, y, width, height, 22);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = PANEL.edge;
    ctx.lineWidth = 3;
    ctx.stroke();
    rounded(x + 8, y + 8, width - 16, height - 16, 16);
    ctx.strokeStyle = 'rgba(220, 232, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // corner sparkles
    ctx.fillStyle = '#ffe9a8';
    for (const [sx, sy] of [[x + 26, y + 26], [x + width - 26, y + 26], [x + 26, y + height - 26], [x + width - 26, y + height - 26]]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy - 8);
      ctx.lineTo(sx + 2.4, sy);
      ctx.lineTo(sx, sy + 8);
      ctx.lineTo(sx - 2.4, sy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textBaseline = 'alphabetic';
    bigLabel(title, FIELD.width / 2, y + 84, 52, '#ffffff');
    // divider with a diamond in the middle
    ctx.strokeStyle = 'rgba(255, 233, 168, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(FIELD.width / 2 - 130, y + 104);
    ctx.lineTo(FIELD.width / 2 - 14, y + 104);
    ctx.moveTo(FIELD.width / 2 + 14, y + 104);
    ctx.lineTo(FIELD.width / 2 + 130, y + 104);
    ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.moveTo(FIELD.width / 2, y + 96);
    ctx.lineTo(FIELD.width / 2 + 7, y + 104);
    ctx.lineTo(FIELD.width / 2, y + 112);
    ctx.lineTo(FIELD.width / 2 - 7, y + 104);
    ctx.closePath();
    ctx.fill();
    lines.forEach((line, i) => label(line, FIELD.width / 2, y + 150 + i * lineH, 21, '#dbe4ff', 'center'));
    // prompt pill
    font(23, true);
    const pw = ctx.measureText(prompt).width + 44;
    rounded(FIELD.width / 2 - pw / 2, y + height - 62, pw, 38, 19);
    ctx.fillStyle = 'rgba(242, 201, 76, 0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(242, 201, 76, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    label(prompt, FIELD.width / 2, y + height - 34, 23, GOLD, 'center', true);
  }

  function draw(state, screen, best) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    paintField(state);
    if (screen === SCREEN_TITLE) {
      paintPanel('Slime Heist', [
        'Sneak past the guard slimes and cameras, pocket the gem, escape.',
        'Stay out of the light beams — cases and walls block sight.',
        'Move: WASD / arrows / mouse. Sneak: Shift. Q: decoy. E: smoke.',
        `Best ${best}`,
      ], 'Press Space or click to start');
      return;
    }
    paintHud(state);
    if (screen === SCREEN_PAUSED) {
      paintPanel('Paused', ['The guards will wait for you.'], 'Press P to resume');
    } else if (screen === SCREEN_CAUGHT) {
      paintPanel('Caught!', [
        'The alarm tripped. The gem stays in its case… this time.',
        `Score ${state.score - state.toolCost}`,
      ], 'Press Space or click to try again');
    } else if (screen === SCREEN_WIN) {
      paintPanel('Clean Getaway!', [
        'Every gem pocketed, every guard none the wiser.',
        `Score ${state.score - state.toolCost}   Time ${clock(state.totalTime)}`,
        `Best ${best}`,
      ], 'Press Space or click to play again');
    }
  }

  fit();
  window.addEventListener('resize', fit);
  return { draw, toLogical };
}

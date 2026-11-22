// The heist rules and state, with no drawing and no browser in it: a thief
// slime crossing guarded museum rooms from above. Guards patrol waypoints
// with a flashlight cone; cameras sweep fixed mounts; cover and smoke block
// both movement (cover only) and sight. Being seen fills an alarm meter
// (slower while sneaking, faster up close, slower from cameras); a full
// meter — or a guard's touch — means caught. Stand at the gem pedestal to
// pocket the loot, then reach the getaway door. Decoys and smoke help, at a
// score cost. step() advances one fixed step and returns bit flags.
import { ALARM, CAMERA, FIELD, GUARD, LEVELS, PLAYER, SCORE, TOOLS } from './config.js';

export const EVENT_LOOT = 1;
export const EVENT_ROOM = 2;
export const EVENT_WIN = 4;
export const EVENT_CAUGHT = 8;
export const EVENT_SPOTTED = 16;
export const EVENT_DECOY = 32;
export const EVENT_SMOKE = 64;

const TWO_PI = Math.PI * 2;

function angleDiff(a, b) {
  let d = (a - b) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

function turnToward(current, target, maxStep) {
  const d = angleDiff(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Does the segment (x1,y1)-(x2,y2) pass through the rectangle's interior? */
function segmentHitsRect(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tMin = 0;
  let tMax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < rect.x || x1 > rect.x + rect.width) return false;
  } else {
    let t1 = (rect.x - x1) / dx;
    let t2 = (rect.x + rect.width - x1) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y1 < rect.y || y1 > rect.y + rect.height) return false;
  } else {
    let t1 = (rect.y - y1) / dy;
    let t2 = (rect.y + rect.height - y1) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  // Grazing an edge at the very ends (a guard hugging a wall) does not block.
  return tMax > 0.02 && tMin < 0.98;
}

/** Distance from a point to a segment, for smoke sight checks. */
function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function circleHitsRect(x, y, radius, rect) {
  const cx = Math.max(rect.x, Math.min(x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(y, rect.y + rect.height));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < radius * radius;
}

function borderWalls() {
  const w = FIELD.wall;
  return [
    { x: 0, y: 0, width: FIELD.width, height: w, kind: 'wall' },
    { x: 0, y: FIELD.height - w, width: FIELD.width, height: w, kind: 'wall' },
    { x: 0, y: 0, width: w, height: FIELD.height, kind: 'wall' },
    { x: FIELD.width - w, y: 0, width: w, height: FIELD.height, kind: 'wall' },
  ];
}

export function createWorld(random) {
  const player = { x: 0, y: 0, angle: 0, sneaking: false };
  const state = {
    player,
    guards: [],
    cameras: [],
    cover: [],
    smokes: [],
    decoy: null,
    levelIndex: 0,
    levelName: '',
    lootPos: { x: 0, y: 0 },
    exit: { x: 0, y: 0, width: 0, height: 0 },
    hasLoot: false,
    grabProgress: 0,
    alarm: 0,
    spotted: false,
    score: 0,
    decoysLeft: 0,
    smokesLeft: 0,
    toolCost: 0,
    levelTime: 0,
    totalTime: 0,
    banner: 0,
    caught: false,
    won: false,
    levelScore: 0,
  };

  function loadLevel(index) {
    const level = LEVELS[index];
    state.levelIndex = index;
    state.levelName = level.name;
    state.cover = borderWalls().concat(level.cover);
    state.lootPos = { x: level.loot.x, y: level.loot.y };
    state.exit = level.exit;
    state.hasLoot = false;
    state.grabProgress = 0;
    state.alarm = 0;
    state.spotted = false;
    state.levelTime = 0;
    state.smokes = [];
    state.decoy = null;
    state.decoysLeft = TOOLS.decoysPerRoom;
    state.smokesLeft = TOOLS.smokesPerRoom;
    player.x = level.start.x;
    player.y = level.start.y;
    player.angle = 0;
    player.sneaking = false;
    state.guards = level.guards.map((spec) => {
      const first = spec.waypoints[0];
      const second = spec.waypoints[1 % spec.waypoints.length];
      return {
        x: first.x,
        y: first.y,
        angle: Math.atan2(second.y - first.y, second.x - first.x),
        speed: spec.speed,
        waypoints: spec.waypoints,
        target: 1 % spec.waypoints.length,
        mode: 'patrol',
        pauseTimer: 0,
        pauseBase: 0,
        sweepPhase: random() * TWO_PI,
        alert: false,
        investigateTimer: 0,
        investigateX: 0,
        investigateY: 0,
      };
    });
    state.cameras = (level.cameras || []).map((spec) => ({
      x: spec.x,
      y: spec.y,
      baseAngle: spec.angle,
      angle: spec.angle,
      phase: random() * TWO_PI,
      alert: false,
    }));
  }

  function reset() {
    state.score = 0;
    state.toolCost = 0;
    state.totalTime = 0;
    state.banner = 0;
    state.caught = false;
    state.won = false;
    state.levelScore = 0;
    loadLevel(0);
  }

  function losClear(x1, y1, x2, y2) {
    for (const rect of state.cover) {
      if (segmentHitsRect(x1, y1, x2, y2, rect)) return false;
    }
    for (const smoke of state.smokes) {
      if (pointSegmentDistance(smoke.x, smoke.y, x1, y1, x2, y2) < TOOLS.smokeRadius * 0.85) return false;
    }
    return true;
  }

  /** Can this guard see a point at (x, y) right now? */
  function guardSees(guard, x, y) {
    const dx = x - guard.x;
    const dy = y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist > GUARD.viewRange) return false;
    if (dist > GUARD.radius + 2 && Math.abs(angleDiff(Math.atan2(dy, dx), guard.angle)) > GUARD.viewHalfAngle) return false;
    return losClear(guard.x, guard.y, x, y);
  }

  /** Can this camera see a point at (x, y) right now? */
  function cameraSees(camera, x, y) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const dist = Math.hypot(dx, dy);
    if (dist > CAMERA.viewRange || dist < 8) return false;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), camera.angle)) > CAMERA.viewHalfAngle) return false;
    return losClear(camera.x, camera.y, x, y);
  }

  /** Can any guard or camera see a point at (x, y)? Used by the screenshot autopilot. */
  function isSeenAt(x, y) {
    for (const guard of state.guards) {
      if (guardSees(guard, x, y)) return true;
    }
    for (const camera of state.cameras) {
      if (cameraSees(camera, x, y)) return true;
    }
    return false;
  }

  function movePlayer(dt, move) {
    const len = Math.hypot(move.x, move.y);
    player.sneaking = move.sneak === true;
    if (len < 0.01) return;
    const speed = player.sneaking ? PLAYER.sneakSpeed : PLAYER.speed;
    const vx = (move.x / len) * speed * dt;
    const vy = (move.y / len) * speed * dt;
    player.angle = Math.atan2(move.y, move.x);
    // Axis-separated movement so the thief slides along cover.
    const nx = player.x + vx;
    if (!state.cover.some((rect) => circleHitsRect(nx, player.y, PLAYER.radius, rect))) player.x = nx;
    const ny = player.y + vy;
    if (!state.cover.some((rect) => circleHitsRect(player.x, ny, PLAYER.radius, rect))) player.y = ny;
  }

  function stepGuard(guard, dt) {
    if (guard.mode === 'investigate') {
      guard.investigateTimer -= dt;
      const wanted = Math.atan2(guard.investigateY - guard.y, guard.investigateX - guard.x);
      guard.angle = turnToward(guard.angle, wanted, GUARD.turnRate * dt);
      if (guard.investigateTimer <= 0) guard.mode = 'patrol';
      return;
    }
    if (guard.mode === 'pause') {
      guard.pauseTimer -= dt;
      guard.sweepPhase += dt * GUARD.sweepRate;
      guard.angle = guard.pauseBase + Math.sin(guard.sweepPhase) * GUARD.sweepAngle;
      if (guard.pauseTimer <= 0) {
        guard.mode = 'patrol';
        guard.target = (guard.target + 1) % guard.waypoints.length;
      }
      return;
    }
    if (guard.mode === 'suspicious') {
      const toPlayer = Math.atan2(player.y - guard.y, player.x - guard.x);
      guard.angle = turnToward(guard.angle, toPlayer, GUARD.turnRate * dt);
      return;
    }
    const target = guard.waypoints[guard.target];
    const dx = target.x - guard.x;
    const dy = target.y - guard.y;
    const dist = Math.hypot(dx, dy);
    const wanted = Math.atan2(dy, dx);
    guard.angle = turnToward(guard.angle, wanted, GUARD.turnRate * dt);
    if (dist <= guard.speed * dt + 1) {
      guard.x = target.x;
      guard.y = target.y;
      guard.mode = 'pause';
      guard.pauseTimer = GUARD.pauseSeconds;
      guard.pauseBase = wanted;
      guard.sweepPhase = 0;
    } else {
      guard.x += (dx / dist) * guard.speed * dt;
      guard.y += (dy / dist) * guard.speed * dt;
    }
  }

  function stepCamera(camera, dt) {
    camera.phase += dt * CAMERA.sweepRate;
    camera.angle = camera.baseAngle + Math.sin(camera.phase) * CAMERA.sweepAngle;
  }

  /** Throw a decoy coin toward (tx, ty): nearby guards turn to the noise. */
  function throwDecoy(tx, ty) {
    if (state.decoysLeft <= 0) return false;
    const dx = tx - player.x;
    const dy = ty - player.y;
    const dist = Math.hypot(dx, dy);
    let lx = tx;
    let ly = ty;
    if (dist > TOOLS.decoyRange && dist > 0.01) {
      lx = player.x + (dx / dist) * TOOLS.decoyRange;
      ly = player.y + (dy / dist) * TOOLS.decoyRange;
    }
    state.decoysLeft -= 1;
    state.toolCost += TOOLS.decoyCost;
    state.decoy = { x: lx, y: ly, timer: GUARD.investigateSeconds };
    for (const guard of state.guards) {
      if (Math.hypot(guard.x - lx, guard.y - ly) < 460) {
        guard.mode = 'investigate';
        guard.investigateTimer = GUARD.investigateSeconds;
        guard.investigateX = lx;
        guard.investigateY = ly;
      }
    }
    return true;
  }

  /** Drop a smoke puff at the thief's feet: sight lines through it break. */
  function dropSmoke() {
    if (state.smokesLeft <= 0) return false;
    state.smokesLeft -= 1;
    state.toolCost += TOOLS.smokeCost;
    state.smokes.push({ x: player.x, y: player.y, timer: TOOLS.smokeSeconds });
    return true;
  }

  function finishLevel() {
    const timeScore = Math.max(SCORE.roomFloor, SCORE.roomBase - Math.floor(state.levelTime) * SCORE.perSecond);
    state.levelScore = Math.max(0, timeScore + (state.spotted ? 0 : SCORE.ghostBonus));
    state.score += state.levelScore;
    if (state.levelIndex + 1 >= LEVELS.length) {
      state.won = true;
      return EVENT_WIN;
    }
    loadLevel(state.levelIndex + 1);
    state.banner = 2.4;
    return EVENT_ROOM;
  }

  /**
   * One fixed step. `move` is {x, y, sneak}: a steering vector (any length)
   * and whether the thief sneaks. `tool` is '' or 'decoy' or 'smoke', with
   * `aim` the decoy's target point. With `harmless` set (the title screen's
   * backdrop) guards patrol but nobody is seen, caught or scored.
   */
  function step(dt, move, harmless, tool, aim) {
    let events = 0;
    if (state.banner > 0) state.banner = Math.max(0, state.banner - dt);
    for (const guard of state.guards) stepGuard(guard, dt);
    for (const camera of state.cameras) stepCamera(camera, dt);
    // Smoke and decoy timers run even on the title backdrop (they are empty there).
    for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
      state.smokes[i].timer -= dt;
      if (state.smokes[i].timer <= 0) state.smokes.splice(i, 1);
    }
    if (state.decoy) {
      state.decoy.timer -= dt;
      if (state.decoy.timer <= 0) state.decoy = null;
    }
    if (harmless) return events;

    state.levelTime += dt;
    state.totalTime += dt;
    movePlayer(dt, move);

    if (tool === 'decoy') {
      const target = aim || {
        x: player.x + Math.cos(player.angle) * 220,
        y: player.y + Math.sin(player.angle) * 220,
      };
      if (throwDecoy(target.x, target.y)) events |= EVENT_DECOY;
    } else if (tool === 'smoke') {
      if (dropSmoke()) events |= EVENT_SMOKE;
    }

    // Alarm: the strongest watcher sets the fill rate.
    let seen = false;
    let fill = 0;
    for (const guard of state.guards) {
      const dist = Math.hypot(player.x - guard.x, player.y - guard.y);
      if (dist < PLAYER.radius + GUARD.radius + 2) {
        state.caught = true;
        return events | EVENT_CAUGHT;
      }
      if (guardSees(guard, player.x, player.y)) {
        seen = true;
        const closeness = 1 - (dist / GUARD.viewRange) * 0.6;
        fill = Math.max(fill, ALARM.guardFillRate * closeness * (player.sneaking ? ALARM.sneakFactor : 1));
        if (state.alarm > ALARM.suspiciousAt && guard.mode !== 'investigate') guard.mode = 'suspicious';
        guard.alert = true;
      } else {
        guard.alert = false;
        if (guard.mode === 'suspicious' && state.alarm < 0.1) guard.mode = 'patrol';
      }
    }
    for (const camera of state.cameras) {
      if (cameraSees(camera, player.x, player.y)) {
        seen = true;
        const dist = Math.hypot(player.x - camera.x, player.y - camera.y);
        const closeness = 1 - (dist / CAMERA.viewRange) * 0.5;
        fill = Math.max(fill, ALARM.cameraFillRate * closeness * (player.sneaking ? ALARM.sneakFactor : 1));
        camera.alert = true;
      } else {
        camera.alert = false;
      }
    }
    if (seen) {
      state.alarm = Math.min(1, state.alarm + fill * dt);
      if (!state.spotted && state.alarm > ALARM.spottedAt) {
        state.spotted = true;
        events |= EVENT_SPOTTED;
      }
      if (state.alarm >= 1) {
        state.caught = true;
        return events | EVENT_CAUGHT;
      }
    } else {
      state.alarm = Math.max(0, state.alarm - ALARM.decayRate * dt);
      for (const guard of state.guards) {
        if (guard.mode === 'suspicious' && state.alarm < 0.1) guard.mode = 'patrol';
      }
    }

    // Loot: stand at the pedestal for a moment to pocket the gem.
    if (!state.hasLoot) {
      if (Math.hypot(player.x - state.lootPos.x, player.y - state.lootPos.y) < 34) {
        state.grabProgress = Math.min(1, state.grabProgress + dt / PLAYER.grabSeconds);
        if (state.grabProgress >= 1) {
          state.hasLoot = true;
          events |= EVENT_LOOT;
        }
      } else {
        state.grabProgress = Math.max(0, state.grabProgress - dt * 1.5);
      }
    }

    const exit = state.exit;
    if (state.hasLoot && player.x > exit.x && player.x < exit.x + exit.width && player.y > exit.y && player.y < exit.y + exit.height) {
      events |= finishLevel();
    }
    return events;
  }

  reset();
  return { state, reset, step, isSeenAt, losClear };
}

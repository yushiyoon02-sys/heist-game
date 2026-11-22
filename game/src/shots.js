// The screenshot scenes behind ?shot=start|play|caught|win. Each one plays
// the real rules forward from a fresh world, steered by an autopilot: a grid
// A* path to the gem pedestal and then the exit, waiting (sneaking) whenever
// the next step would be seen, retreating to the nearest unseen cell when
// the alarm meter climbs. The caught scene walks into a guard's beam on
// purpose. The same seed always gives the same frame.
import { FIELD, PLAYER, STEP } from './config.js';
import { EVENT_CAUGHT, EVENT_ROOM, EVENT_WIN } from './world.js';
import { SCREEN_CAUGHT, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';

const START_SECONDS = 4;
const PLAY_SECONDS = 5;
const CAUGHT_LIMIT_SECONDS = 90;
const WIN_LIMIT_SECONDS = 900;
const CELL = 32;
const COLS = Math.ceil(FIELD.width / CELL);
const ROWS = Math.ceil(FIELD.height / CELL);

function cellOf(x, y) {
  return {
    cx: Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))),
    cy: Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))),
  };
}

function cellCentre(cx, cy) {
  return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
}

/** How close (logical pixels) a path cell may come to a guard's current spot. */
const GUARD_KEEPOUT = 56;

function blocked(state, cx, cy, avoidGuards) {
  const centre = cellCentre(cx, cy);
  const pad = PLAYER.radius + 3;
  for (const rect of state.cover) {
    if (centre.x > rect.x - pad && centre.x < rect.x + rect.width + pad && centre.y > rect.y - pad && centre.y < rect.y + rect.height + pad) return true;
  }
  if (avoidGuards) {
    for (const guard of state.guards) {
      if (Math.hypot(centre.x - guard.x, centre.y - guard.y) < GUARD_KEEPOUT) return true;
    }
  }
  return false;
}

/** A* over the grid; returns cell centres from start (exclusive) to goal (inclusive). */
function findPath(state, from, to) {
  const start = cellOf(from.x, from.y);
  const goal = cellOf(to.x, to.y);
  const key = (cx, cy) => cy * COLS + cx;
  const open = [{ cx: start.cx, cy: start.cy, g: 0, f: 0 }];
  const came = new Map();
  const gScore = new Map([[key(start.cx, start.cy), 0]]);
  const closed = new Set();
  const heuristic = (cx, cy) => Math.abs(cx - goal.cx) + Math.abs(cy - goal.cy);
  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.cx, current.cy);
    if (current.cx === goal.cx && current.cy === goal.cy) {
      const path = [];
      let node = current;
      while (node && !(node.cx === start.cx && node.cy === start.cy)) {
        path.unshift(cellCentre(node.cx, node.cy));
        node = came.get(key(node.cx, node.cy));
      }
      path.push({ x: to.x, y: to.y });
      return path;
    }
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = current.cx + dx;
      const ny = current.cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (!(nx === goal.cx && ny === goal.cy) && blocked(state, nx, ny, true)) continue;
      const g = current.g + 1;
      const neighbourKey = key(nx, ny);
      if (g >= (gScore.get(neighbourKey) ?? Infinity)) continue;
      gScore.set(neighbourKey, g);
      came.set(neighbourKey, current);
      open.push({ cx: nx, cy: ny, g, f: g + heuristic(nx, ny) });
    }
  }
  return [];
}

/** The nearest grid cell no watcher can currently see, for retreating. */
function nearestSafeCell(world) {
  const state = world.state;
  const start = cellOf(state.player.x, state.player.y);
  const seen = new Set([start.cy * COLS + start.cx]);
  const queue = [start];
  while (queue.length > 0) {
    const cell = queue.shift();
    const centre = cellCentre(cell.cx, cell.cy);
    if (!blocked(state, cell.cx, cell.cy) && !world.isSeenAt(centre.x, centre.y)) return centre;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cell.cx + dx;
      const ny = cell.cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const k = ny * COLS + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ cx: nx, cy: ny });
    }
  }
  return null;
}

/**
 * One autopilot move: head for the objective along an A* path, wait sneaking
 * while the next step would be seen, and retreat when the alarm climbs.
 */
function autopilot(world, pilot) {
  const state = world.state;
  const player = state.player;
  pilot.steps += 1;
  // Step aside when a guard is about to walk into the thief.
  for (const guard of state.guards) {
    const dx = player.x - guard.x;
    const dy = player.y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 66 && dist > 0.01) {
      return { x: dx / dist, y: dy / dist, sneak: false };
    }
  }
  let target;
  if (state.alarm > 0.45) {
    target = nearestSafeCell(world) ?? player;
    pilot.path = findPath(state, player, target);
  } else {
    target = state.hasLoot
      ? { x: state.exit.x + state.exit.width / 2, y: state.exit.y + state.exit.height / 2 }
      : state.lootPos;
    // Replan regularly: guard keep-out zones move with the patrols.
    if (pilot.targetKey !== `${target.x},${target.y},${state.levelIndex}` || pilot.path.length === 0 || pilot.steps % 25 === 0) {
      pilot.path = findPath(state, player, target);
      pilot.targetKey = `${target.x},${target.y},${state.levelIndex}`;
    }
  }
  while (pilot.path.length > 0 && Math.hypot(pilot.path[0].x - player.x, pilot.path[0].y - player.y) < 10) pilot.path.shift();
  const next = pilot.path[0] ?? target;
  const dx = next.x - player.x;
  const dy = next.y - player.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) return { x: 0, y: 0, sneak: true };
  // Wait while the ground ahead is watched, unless already seen (then keep moving out of it).
  const aheadX = player.x + (dx / dist) * 30;
  const aheadY = player.y + (dy / dist) * 30;
  if (!world.isSeenAt(player.x, player.y) && world.isSeenAt(aheadX, aheadY) && state.alarm <= 0.45) {
    return { x: 0, y: 0, sneak: true };
  }
  return { x: dx, y: dy, sneak: world.isSeenAt(player.x, player.y) };
}

/** Walk toward the nearest guard's front until caught, for the caught scene. */
function reckless(world) {
  const state = world.state;
  let nearest = null;
  let nearestDist = Infinity;
  for (const guard of state.guards) {
    const dist = Math.hypot(guard.x - state.player.x, guard.y - state.player.y);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = guard;
    }
  }
  const front = {
    x: nearest.x + Math.cos(nearest.angle) * 70,
    y: nearest.y + Math.sin(nearest.angle) * 70,
  };
  return { x: front.x - state.player.x, y: front.y - state.player.y, sneak: false };
}

/**
 * Set `world` to the named scene (start, play, caught or win; any other name
 * is start) and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'caught' && name !== 'win') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) world.step(STEP, { x: 0, y: 0, sneak: false }, true);
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'caught') {
    for (let index = 0; index < CAUGHT_LIMIT_SECONDS / STEP; index += 1) {
      if (world.step(STEP, reckless(world), false) & EVENT_CAUGHT) break;
    }
    return { screen: world.state.caught ? SCREEN_CAUGHT : SCREEN_PLAY, best: world.state.score - world.state.toolCost };
  }
  const pilot = { path: [], targetKey: '', steps: 0 };
  const limit = name === 'win' ? WIN_LIMIT_SECONDS : PLAY_SECONDS;
  for (let index = 0; index < limit / STEP; index += 1) {
    const events = world.step(STEP, autopilot(world, pilot), false);
    if (events & EVENT_CAUGHT) return { screen: SCREEN_CAUGHT, best: world.state.score - world.state.toolCost };
    if (events & EVENT_WIN) return { screen: SCREEN_WIN, best: world.state.score - world.state.toolCost };
    if (name === 'play' && events & EVENT_ROOM) break;
  }
  return { screen: world.state.won ? SCREEN_WIN : SCREEN_PLAY, best: world.state.score - world.state.toolCost };
}

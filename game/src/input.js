// Keyboard and pointer input for the heist. Held keys (WASD or arrows) steer
// in eight directions; holding the mouse button steers toward the pointer
// instead. Shift sneaks. Q throws a decoy coin, E drops a smoke puff.
// One-shot presses (start or restart, pause, tools) are queued as bit flags
// and taken once by the loop, so a press between two frames is never lost
// and never counted twice.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_DECOY = 4;
export const ACTION_SMOKE = 8;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const SNEAK = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const DECOY = new Set(['KeyQ']);
const SMOKE = new Set(['KeyE']);

/** Pointer steering ignores targets closer than this (logical pixels). */
const POINTER_DEADZONE = 14;

export function createInput(target, toLogical) {
  const held = { up: false, down: false, left: false, right: false, sneak: false };
  let actions = 0;
  let pointerHeld = false;
  let pointer = { x: 0, y: 0 };
  let pointerSeen = false;

  function setKey(code, down) {
    if (UP.has(code)) held.up = down;
    else if (DOWN.has(code)) held.down = down;
    else if (LEFT.has(code)) held.left = down;
    else if (RIGHT.has(code)) held.right = down;
    else if (SNEAK.has(code)) held.sneak = down;
    else return false;
    return true;
  }

  window.addEventListener('keydown', (event) => {
    if (setKey(event.code, true)) {
      event.preventDefault();
      return;
    }
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (DECOY.has(event.code)) {
      if (!event.repeat) actions |= ACTION_DECOY;
    } else if (SMOKE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_SMOKE;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    setKey(event.code, false);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.up = held.down = held.left = held.right = held.sneak = false;
    pointerHeld = false;
  });
  target.addEventListener('pointerdown', (event) => {
    actions |= ACTION_CONFIRM;
    pointerHeld = true;
    pointerSeen = true;
    pointer = toLogical(event.clientX, event.clientY);
  });
  target.addEventListener('pointermove', (event) => {
    pointerSeen = true;
    pointer = toLogical(event.clientX, event.clientY);
  });
  window.addEventListener('pointerup', () => {
    pointerHeld = false;
  });

  return {
    /**
     * The steering for this frame: {x, y, sneak}. The pointer, while held,
     * wins over the keys; `from` is the thief's position.
     */
    move(from) {
      if (pointerHeld) {
        const dx = pointer.x - from.x;
        const dy = pointer.y - from.y;
        if (Math.hypot(dx, dy) > POINTER_DEADZONE) return { x: dx, y: dy, sneak: held.sneak };
        return { x: 0, y: 0, sneak: held.sneak };
      }
      return {
        x: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        y: (held.down ? 1 : 0) - (held.up ? 1 : 0),
        sneak: held.sneak,
      };
    },
    /** Where the pointer last was, for aiming a decoy coin; null if never seen. */
    aim() {
      return pointerSeen ? pointer : null;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}

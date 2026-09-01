'use strict';
/**
 * Keys that work while you are somewhere else.
 *
 * This is the piece the whole idea rests on. A plugin inside a web page can
 * only hear keys when that page has focus, and the entire point here is to talk
 * to the agent while you are driving, playing or writing in another window. So
 * the companion window registers real system-wide shortcuts and turns them into
 * orders for the page.
 *
 * A wheel button usually reaches the PC as an ordinary keystroke once it is
 * mapped in the wheel's own software, which is why plain accelerators are
 * enough and no gamepad plumbing is needed.
 */

const { globalShortcut } = require('electron');

/**
 * Never registered, whatever the person asks for.
 *
 * Registering one of these takes it away from EVERY application on the machine,
 * not just ours. This is not theoretical: a Ctrl+C bound as a global shortcut
 * once left a whole PC unable to copy, and nobody connected the two for hours.
 */
const FORBIDDEN = new Set([
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y',
  'Ctrl+A', 'Ctrl+S', 'Ctrl+W', 'Ctrl+F', 'Ctrl+P',
  'Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete',
]);

/** The orders a key can be bound to. Anything else is refused by name. */
// In the same order as the circles on the bar, and called the same thing.
// A control with two names is two controls as far as anybody using it is
// concerned.
const ACTIONS = ['record-toggle', 'talk-toggle', 'mic-mute', 'speak-last', 'stop-speaking', 'menu-toggle'];

/** Sensible out of the box, and deliberately odd enough not to collide:
 *  function keys are free on almost every keyboard and easy to map a wheel
 *  button to. */
const DEFAULTS = {
  // Same order as the bar reads, left to right: one turn first, then the open
  // conversation.
  'record-toggle': 'F8',
  'talk-toggle': 'F9',
  // Silenciar el microfono: la tecla que mas falta hace cuando estas en otra
  // aplicacion y no quieres que te oiga.
  'mic-mute': 'F7',
  'speak-last': 'F10',
  'stop-speaking': 'F11',
  // Abrir el menu de la ventana. NO viaja al arnes: es cosa de la propia
  // ventana, y el proceso principal la atiende sin salir de casa.
  'menu-toggle': 'F6',
};

function create({ send, onError }) {
  /** name -> accelerator currently registered (or null) */
  const bound = Object.create(null);
  for (const action of ACTIONS) bound[action] = null;

  const report = (message) => { try { onError(message); } catch { /* reporting must not throw */ } };

  function release(action) {
    const current = bound[action];
    if (!current) return;
    try { globalShortcut.unregister(current); } catch { /* already gone */ }
    bound[action] = null;
  }

  /**
   * set(action, accelerator) -> { ok, reason? }
   * An empty accelerator clears the binding. Every refusal says why: a key that
   * silently does not work is the worst possible outcome here, because the
   * person is in another window and cannot see anything at all.
   */
  function set(action, accelerator) {
    if (!ACTIONS.includes(action)) return { ok: false, reason: `Unknown action "${action}".` };

    const wanted = String(accelerator || '').trim();
    release(action);
    if (!wanted) return { ok: true };

    if (FORBIDDEN.has(wanted)) {
      return { ok: false, reason: `${wanted} belongs to the whole system (copy, paste, close). Pick another key.` };
    }
    // The same key cannot drive two actions: the second would silently win.
    for (const other of ACTIONS) {
      if (other !== action && bound[other] === wanted) {
        return { ok: false, reason: `${wanted} is already used for "${other}".` };
      }
    }

    let registered = false;
    try {
      registered = globalShortcut.register(wanted, () => send(action));
    } catch (error) {
      return { ok: false, reason: `${wanted} is not a valid key combination (${error?.message ?? error}).` };
    }
    if (!registered) {
      return { ok: false, reason: `Windows would not give us ${wanted} — another application already holds it.` };
    }

    bound[action] = wanted;
    return { ok: true };
  }

  /** Restore saved keys at start-up; one that no longer works is reported and
   *  left unbound rather than pretended. */
  function restore(saved) {
    // Only what was really CHOSEN overrides a default. What is stored is a
    // full table, and an action nobody has assigned is stored as null — so a
    // plain spread lets those nulls beat the defaults and the keys end up
    // registered to nothing at all. Measured on this machine: all four keys
    // saved as null, and F8 to F11 did nothing.
    const elegido = Object.fromEntries(
      Object.entries(saved || {}).filter(([, tecla]) => typeof tecla === 'string' && tecla)
    );
    const wanted = { ...DEFAULTS, ...elegido };
    for (const action of ACTIONS) {
      const result = set(action, wanted[action]);
      if (!result.ok) report(`${action}: ${result.reason}`);
    }
    return list();
  }

  function list() {
    const out = {};
    for (const action of ACTIONS) out[action] = bound[action];
    return out;
  }

  function releaseAll() {
    for (const action of ACTIONS) release(action);
  }

  return { set, restore, list, releaseAll, ACTIONS, FORBIDDEN, DEFAULTS };
}

module.exports = { create, ACTIONS, FORBIDDEN, DEFAULTS };

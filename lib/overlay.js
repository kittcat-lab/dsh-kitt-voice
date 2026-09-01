/**
 * The companion window, opened on demand.
 *
 * Asking somebody to launch a second thing before they can use the first is
 * asking them to remember something the machine already knows. So the window
 * is opened the moment the voice is used, and closed when the harness stops.
 *
 * It is OFF by default and has to be switched on. A plugin that starts a
 * desktop process on somebody's machine without being asked is a plugin that
 * gets uninstalled, and rightly.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The window's own folder, beside this one. */
export function overlayDir() {
  return path.join(here, '..', 'overlay');
}

/**
 * Where Electron is. In order: what the settings say, what the environment
 * says, and a copy installed beside the window itself. Nothing is ever
 * downloaded — two hundred megabytes is not something to fetch on somebody's
 * behalf while they are mid-race.
 */
export function findElectron(configured) {
  const candidates = [
    configured,
    process.env.DSH_KITT_ELECTRON,
    path.join(overlayDir(), 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(overlayDir(), 'node_modules', 'electron', 'dist', 'electron'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  return '';
}

/**
 * Keeps at most one window alive.
 *
 * `ensure()` is called every time the voice is used, which is often, so it has
 * to be cheap and it has to be safe to call when the window is already there.
 */
export function createOverlay({ onNote } = {}) {
  let child = null;
  let ultimoIntento = 0;
  let dicho = '';

  const note = (message) => {
    // The same complaint over and over is noise. Only what changed is said.
    if (message === dicho) return;
    dicho = message;
    if (onNote) onNote(message);
  };

  return {
    get running() { return Boolean(child && child.exitCode === null); },

    ensure({ electronPath, port }) {
      if (child && child.exitCode === null) return true;

      // If it died on its own, do not sit in a loop restarting it: something
      // is wrong and hammering it will not fix it.
      const ahora = Date.now();
      if (ahora - ultimoIntento < 10000) return false;
      ultimoIntento = ahora;

      const electron = findElectron(electronPath);
      if (!electron) {
        note('The companion window needs Electron and none was found. Set electronPath in Settings, or run npm install in the overlay folder.');
        return false;
      }

      try {
        child = spawn(electron, ['.'], {
          cwd: overlayDir(),
          // A port, never a URL: the window can only ever address loopback.
          env: { ...process.env, DSH_KITT_PORT: String(port) },
          detached: false,
          // stderr is kept: it is where the window reports its own faults.
          // With it ignored, a page error inside the window went nowhere when
          // the plugin was the one who opened it — a bar you can see, dead,
          // and nothing anywhere to read.
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
        });
        // Only the window's own lines. Chromium chats on stderr about GPUs
        // and caches, and none of that is ours to repeat.
        let resto = '';
        child.stderr.on('data', (chunk) => {
          resto += String(chunk);
          const lineas = resto.split(/\r?\n/);
          resto = lineas.pop() || '';
          for (const linea of lineas) {
            if (linea.includes('[dsh-kitt-voice · ventana]')) console.error(linea);
          }
        });
        // Y se cuenta. El ejecutable puede existir y aun así no arrancar; si
        // eso no se dice, la ventana no aparece y no hay nada que mirar.
        child.on('error', (error) => {
          child = null;
          note(`The companion window would not start: ${error?.message ?? error}`);
        });
        child.on('exit', () => { child = null; });
        note('');
        return true;
      } catch (error) {
        child = null;
        note(`The companion window could not be started: ${error?.message ?? error}`);
        return false;
      }
    },

    /** Closed with the harness. A window nobody can see is a window nobody
     *  can close. */
    stop() {
      if (!child) return;
      try { child.kill(); } catch { /* going anyway */ }
      child = null;
    },
  };
}

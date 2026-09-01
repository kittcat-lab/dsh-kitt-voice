/**
 * Telling the user the server is running an old copy of this plugin.
 *
 * The harness loads plugin code once, at boot. Installing or updating a plugin
 * afterwards changes the files on disk but not the process, and restarting the
 * harness does not always kill the previous server — so people reopen the page,
 * see no change, and conclude the plugin is broken. It is not: they are talking
 * to the old process.
 *
 * That confusion costs hours, so the plugin detects it and says so. At boot we
 * record how recently our own source files were written; afterwards we compare
 * that against what is on disk. Newer on disk means the running process is
 * stale, and the only cure is a real restart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Newest modification time across our own source files, in milliseconds. */
function newestSourceTime() {
  let newest = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(LIB_DIR);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.js')) continue;
    try {
      const { mtimeMs } = fs.statSync(path.join(LIB_DIR, entry));
      if (mtimeMs > newest) newest = mtimeMs;
    } catch { /* a file we cannot stat cannot make us stale */ }
  }
  return newest;
}

/**
 * createFreshness() -> { bootedAt, check() }
 *
 * `check()` returns { stale, reason } — `reason` is a sentence meant to be
 * shown to a person, not logged and forgotten.
 */
export function createFreshness() {
  const bootedAt = Date.now();
  const sourceTimeAtBoot = newestSourceTime();

  return {
    bootedAt,
    check() {
      const now = newestSourceTime();
      // A second of slack: file timestamps and clocks disagree by small amounts,
      // and a false alarm here would be worse than a missed one.
      if (!now || !sourceTimeAtBoot || now <= sourceTimeAtBoot + 1000) {
        return { stale: false, reason: '' };
      }
      return {
        stale: true,
        reason:
          'This plugin has been updated on disk since the server started, so what you are using is the old version. ' +
          'Stop the harness completely and start it again — relaunching without stopping the previous process leaves it running, ' +
          'and you will keep talking to the old one.',
      };
    },
  };
}

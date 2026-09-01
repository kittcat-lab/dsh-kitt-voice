/**
 * What this plugin writes down.
 *
 * Almost nothing, on purpose. Every failure a person can act on is already
 * shown to them on screen; a log line as well would be noise. What is written
 * here is only what the person cannot see and would need if they asked for
 * help: how the plugin came up, and requests that were turned away.
 *
 * Two rules, without exception:
 *   - the transcription key never appears, not even partly;
 *   - nothing repeats faster than once a minute, so a page in a retry loop
 *     cannot bury the rest.
 */

const QUIET_MS = 60_000;
const lastSeen = new Map();

function say(level, message) {
  const line = `[dsh-kitt-voice] ${message}`;
  if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Written once, whatever happens afterwards. */
export function logStartup({ sttProvider, hasKey, keySource, voicesDir, voiceCount }) {
  say('info',
    `ready — recogniser: ${sttProvider}; transcription key: ${hasKey ? `configured (${keySource})` : 'not configured'}; ` +
    `voices: ${voiceCount > 0 ? `${voiceCount} found` : 'none (system voice will be used)'}` +
    `${voicesDir ? '' : ' (no voices folder set)'}`);
}

/**
 * A request that was turned away. Worth knowing — it usually means either a
 * misconfigured companion or a page that had no business calling — but not
 * worth repeating, so each distinct reason is written at most once a minute.
 */
export function logRefused(reason) {
  const now = Date.now();
  const previous = lastSeen.get(reason) || 0;
  if (now - previous < QUIET_MS) return;
  lastSeen.set(reason, now);
  say('warn', `refused a request: ${reason}`);
}

/**
 * Something the person needs to know while the harness is running, said once.
 *
 * Not an error and not a startup line: the companion window failing to open
 * belongs here. The caller is responsible for not repeating itself.
 */
export function logNote(message) {
  if (!message) return;
  console.log(`[dsh-kitt-voice] ${message}`);
}

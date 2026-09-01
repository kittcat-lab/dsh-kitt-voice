/**
 * Finding the transcription key without ever holding it.
 *
 * The harness already has a place for secrets — the same store that holds the
 * key the agent itself uses — and it is a better place than an environment
 * variable in every way that matters: the person sets it once, in the app, and
 * it survives restarts without anyone editing Windows settings. Asking a user
 * to create an environment variable to say one sentence is a barrier that
 * loses most of them at the door.
 *
 * Two rules this module exists to keep:
 *
 *   - the value is resolved per call and never cached. That is the store's own
 *     instruction, and it is what lets a rotated key reach the next request
 *     without restarting anything.
 *
 *   - asking WHETHER a key exists never resolves it. The page is told
 *     "configured: yes" through a separate call that cannot return a value, so
 *     there is no path by which the secret reaches the browser.
 */

/** References are plain names in the store's own grammar. */
const REF_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function isUsableRef(ref) {
  return REF_PATTERN.test(String(ref || ''));
}

/**
 * resolveApiKey(ctx, ref) -> { key, source }
 *
 * `source` says where it came from, never what it is: it is shown in Settings
 * so somebody chasing a wrong key knows which one the plugin actually used.
 */
export async function resolveApiKey(ctx, ref) {
  if (ctx?.credentials && isUsableRef(ref)) {
    try {
      const resolved = await ctx.credentials.resolve(ref);
      if (resolved?.value) return { key: resolved.value, source: resolved.source || 'harness credentials' };
    } catch {
      // A store that cannot answer is not a reason to fail: the environment
      // may still hold a key, and the caller reports the absence either way.
    }
  }
  const fromEnv = process.env.DSH_KITT_API_KEY || process.env.GROQ_API_KEY || '';
  if (fromEnv) return { key: fromEnv, source: 'environment' };
  return { key: '', source: '' };
}

/**
 * describeApiKey(ctx, ref) -> { configured, source }
 *
 * The question the page is allowed to ask. It cannot return a value even by
 * accident, because it never asks for one.
 */
export async function describeApiKey(ctx, ref) {
  if (ctx?.credentials && isUsableRef(ref)) {
    try {
      const info = await ctx.credentials.describe(ref);
      if (info?.configured) return { configured: true, source: info.source || 'harness credentials' };
    } catch {
      /* fall through to the environment */
    }
  }
  const inEnv = Boolean(process.env.DSH_KITT_API_KEY || process.env.GROQ_API_KEY);
  return { configured: inEnv, source: inEnv ? 'environment' : '' };
}

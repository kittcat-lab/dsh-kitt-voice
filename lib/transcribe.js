/**
 * Speech to text.
 *
 * The recorded audio is sent to the provider EXACTLY as the browser produced
 * it (webm/opus). It is never decoded in the page first: decoding audio in an
 * Electron/Chromium renderer has been measured to freeze the whole window, and
 * Whisper endpoints accept the container as-is.
 *
 * Every failure returns a reason in plain language. Nothing ever fails silently.
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';
const TIMEOUT_MS = 60_000;
const MIN_BYTES = 1000;

/** Coerce whatever crossed the wire into a Buffer, or null. */
function toBytes(audio) {
  if (!audio) return null;
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  if (ArrayBuffer.isView(audio)) return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  return null;
}

/**
 * transcribe({ audio, mime, language, prompt, apiKey, endpoint, model, fetchImpl })
 *   -> { ok: true, text } | { ok: false, reason }
 *
 * `language` is a plain ISO code ("es", "en", ...). Whisper is multilingual;
 * passing the code makes it noticeably more accurate than letting it guess.
 * Leave it empty to auto-detect.
 *
 * `prompt` is optional Whisper guidance text: the provider biases its
 * vocabulary towards the words it contains. It exists for the sim-racing
 * case where a Spanish speaker says English terms (setup, brake bias,
 * understeer): without guidance Whisper writes them phonetically in Spanish
 * ("cetap", "breik baias") and the agent receives garbage. The prompt is
 * only sent when non-empty, so callers that do not care are unaffected.
 */
export async function transcribe(options = {}) {
  const {
    audio,
    mime = 'audio/webm',
    language = 'es',
    prompt = '',
    apiKey,
    endpoint = GROQ_ENDPOINT,
    model = GROQ_MODEL,
    fetchImpl = globalThis.fetch,
  } = options;

  if (!apiKey) {
    return { ok: false, reason: 'No transcription API key is configured. Add one in Settings.' };
  }

  const bytes = toBytes(audio);
  if (!bytes || bytes.length < MIN_BYTES) {
    return { ok: false, reason: 'Nothing was recorded — the microphone produced no audio.' };
  }

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), 'speech.webm');
  form.append('model', model);
  const lang = String(language || '').trim();
  if (lang) form.append('language', lang);
  const guide = String(prompt || '').trim();
  if (guide) form.append('prompt', guide);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'The transcription API key was rejected. Check it in Settings.' };
    }
    if (response.status === 429) {
      return { ok: false, reason: 'The transcription service says you have hit its rate limit. Wait and try again.' };
    }
    if (!response.ok) {
      return { ok: false, reason: `The transcription service answered ${response.status}.` };
    }

    const body = await response.json();
    const text = String((body && body.text) || '').trim();
    if (!text) {
      return { ok: false, reason: 'Nothing recognisable was heard.' };
    }
    return { ok: true, text };
  } catch (error) {
    clearTimeout(timer);
    if (error && error.name === 'AbortError') {
      return { ok: false, reason: `The transcription service took longer than ${TIMEOUT_MS / 1000}s. Try a shorter phrase.` };
    }
    return { ok: false, reason: 'Could not reach the transcription service: ' + (error?.message ?? String(error)) };
  }
}

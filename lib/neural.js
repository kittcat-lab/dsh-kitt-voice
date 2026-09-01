/**
 * Neural voices, from Microsoft's read-aloud service.
 *
 * Piper is local and private and that is why it is still here. But its best
 * Spanish model still sounds like a machine reading, and a machine reading is
 * something you stop listening to — which for a co-driver is the whole job.
 * These voices do not sound like that.
 *
 * THE PRICE, stated plainly because it is a real one: this sends the text of
 * the reply to Microsoft. Nothing else — no audio, no key, no account — but
 * the words leave the machine. It is off unless a neural voice is chosen, and
 * choosing one is how you agree to that.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

/** A voice name that could be a path is not a voice name. */
const VOICE_ID = /^[a-zA-Z]{2}-[a-zA-Z]{2,3}-[A-Za-z]+Neural$/;

export function isNeuralVoice(name) {
  return VOICE_ID.test(String(name || ''));
}

/**
 * synthesize({ text, voice }) -> { ok, audioBase64, mime } | { ok: false, reason }
 *
 * Returns mp3, not wav: it is a fifth of the size over a socket and every
 * browser plays it. The caller is told the type rather than having to assume.
 */
export async function synthesize({ text, voice, rate } = {}) {
  const dicho = String(text || '').trim();
  if (!dicho) return { ok: false, reason: 'There was nothing to read.' };
  if (!isNeuralVoice(voice)) return { ok: false, reason: 'That is not a neural voice name.' };

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // La velocidad va como número relativo: 1 es el ritmo natural de la voz,
    // 2 el doble. Sólo se manda cuando NO es el natural — un servicio al que
    // se le pide lo de siempre es mejor no pedírselo.
    const ritmo = Number(rate);
    const opciones = Number.isFinite(ritmo) && ritmo !== 1 ? { rate: ritmo } : undefined;
    const { audioStream } = await tts.toStream(dicho, opciones);
    const trozos = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (c) => trozos.push(c));
      audioStream.on('end', resolve);
      audioStream.on('error', reject);
    });
    const audio = Buffer.concat(trozos);
    if (!audio.length) return { ok: false, reason: 'The neural voice returned nothing.' };
    return { ok: true, audioBase64: audio.toString('base64'), mime: 'audio/mpeg' };
  } catch (error) {
    // Named, not swallowed: without a connection this is the failure people
    // will actually hit, and «synthesis failed» tells them nothing.
    return { ok: false, reason: `The neural voice could not be reached: ${error?.message ?? error}` };
  }
}

/**
 * The neural voices worth offering, grouped by language.
 *
 * Fetched from the service rather than written down here: a list in the source
 * is a list that is wrong a year from now, and this one costs one call which
 * is then kept for as long as the harness runs.
 *
 * Spanish, English and Chinese because those are the three this plugin claims,
 * and Spanish means Spain AND the Americas — half the people who speak it do
 * not sound like Madrid.
 */
const IDIOMAS = ['es-', 'en-', 'zh-'];
let guardadas = null;

export async function listVoices() {
  if (guardadas) return guardadas;
  try {
    const todas = await new MsEdgeTTS().getVoices();
    const nuestras = todas
      .filter((v) => IDIOMAS.some((p) => String(v.Locale || '').startsWith(p)))
      // A name that could not be a voice name never becomes one.
      .filter((v) => isNeuralVoice(v.ShortName))
      .map((v) => ({
        id: v.ShortName,
        language: v.Locale,
        gender: v.Gender === 'Male' ? 'hombre' : 'mujer',
      }));
    // Only cached once it worked. Caching an empty list because the network was
    // down would leave the menu empty until the harness restarted.
    if (nuestras.length) guardadas = nuestras;
    return nuestras;
  } catch {
    return [];
  }
}

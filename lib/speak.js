/**
 * Text to speech with local Piper voices.
 *
 * Piper runs on the CPU at roughly fifteen times real time and costs nothing
 * per use, so replies can be read aloud without sending the conversation to a
 * cloud service. Neither the engine nor the voices ship with this plugin —
 * they are hundreds of megabytes — so the user points the plugin at a folder
 * that already contains them.
 *
 * A voice folder is expected to look like this:
 *
 *   <voicesDir>/
 *     piper/piper.exe          (or `piper` on Linux and macOS)
 *     es_ES-davefx-medium.onnx
 *     es_ES-davefx-medium.onnx.json
 *     ...
 *
 * If the engine or the chosen voice is missing, the caller is told which one
 * and can fall back to the operating system voice.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SYNTHESIS_TIMEOUT_MS = 20_000;

/**
 * A voice id names a file inside the voices folder, so it must not be able to
 * point anywhere else. The caller validates it against the real list today, but
 * a module that builds a path from a caller-supplied string has to defend
 * itself: the next caller may be less careful, and a path is not the place to
 * find that out.
 */
const VOICE_ID = /^[A-Za-z0-9._-]+$/;

function isSafeVoiceId(voice) {
  const id = String(voice || '');
  return Boolean(id) && VOICE_ID.test(id) && !id.includes('..');
}

/** Absolute path of the Piper executable inside a voices folder, or null. */
export function findEngine(voicesDir) {
  if (!voicesDir) return null;
  const candidates = [
    path.join(voicesDir, 'piper', 'piper.exe'),
    path.join(voicesDir, 'piper', 'piper'),
    path.join(voicesDir, 'piper.exe'),
    path.join(voicesDir, 'piper'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * listVoices(voicesDir) -> [{ id, language }]
 * Every `.onnx` model in the folder is a voice. The id is the file name, which
 * is also what Piper is given on the command line.
 */
export function listVoices(voicesDir) {
  if (!voicesDir) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(voicesDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.onnx'))
    .map((entry) => entry.slice(0, -'.onnx'.length))
    .filter(isSafeVoiceId)
    .map((id) => {
      const language = (id.split('-')[0] || '').replace('_', '-');
      return { id, language };
    });
}

/**
 * synthesize({ text, voice, voicesDir }) -> { ok: true, wavBase64 } | { ok: false, reason }
 *
 * The audio comes back as base64 so the page can play it with a plain
 * `new Audio('data:audio/wav;base64,...')`. No temporary file survives.
 */
export function synthesize({ text, voice, voicesDir, rate } = {}) {
  return new Promise((resolve) => {
    const spoken = String(text || '').trim();
    if (!spoken) return resolve({ ok: false, reason: 'There was nothing to read.' });

    if (!isSafeVoiceId(voice)) {
      return resolve({ ok: false, reason: 'That voice name is not valid.' });
    }

    const engine = findEngine(voicesDir);
    if (!engine) {
      return resolve({ ok: false, reason: 'The Piper engine was not found. Set the voices folder in Settings, or use the system voice.' });
    }

    const model = path.join(voicesDir, `${voice}.onnx`);
    if (!fs.existsSync(model)) {
      return resolve({ ok: false, reason: `The voice "${voice}" is not in the voices folder.` });
    }

    const output = path.join(os.tmpdir(), `dsh-kitt-voice-${process.pid}-${Date.now()}.wav`);

    // PIPER MIDE AL REVÉS. No tiene «velocidad»: tiene `length_scale`, que es
    // lo que dura cada fonema. Alargar los sonidos es hablar más despacio, así
    // que la escala es la INVERSA del ritmo — el doble de rápido son fonemas
    // de la mitad de largos. Comprobado contra `piper --help` en esta máquina:
    // el valor de fábrica es 1.0 y la opción lleva guion bajo, como
    // `--output_file`.
    const ritmo = Number(rate);
    const escala = Number.isFinite(ritmo) && ritmo > 0 && ritmo !== 1
      ? ['--length_scale', String(Math.round((1 / ritmo) * 1000) / 1000)]
      : [];

    let child;
    try {
      child = spawn(engine, ['--model', model, '--output_file', output, ...escala], { windowsHide: true });
    } catch (error) {
      return resolve({ ok: false, reason: 'Piper would not start: ' + (error?.message ?? String(error)) });
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      // Sin esto, el wav que Piper no llegó a terminar se queda en TEMP.
      try { fs.unlinkSync(output); } catch { /* no file to remove */ }
      resolve({ ok: false, reason: `Piper took longer than ${SYNTHESIS_TIMEOUT_MS / 1000}s.` });
    }, SYNTHESIS_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: error?.message ?? String(error) });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const wav = fs.readFileSync(output);
        fs.unlinkSync(output);
        resolve({ ok: true, wavBase64: wav.toString('base64') });
      } catch (error) {
        resolve({ ok: false, reason: `Piper exited with code ${code} and produced no audio: ${error?.message ?? String(error)}` });
      }
    });

    child.stdin.write(spoken + '\n');
    child.stdin.end();
  });
}

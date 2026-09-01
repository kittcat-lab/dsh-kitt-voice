/**
 * The turn detector's files, and how they get here.
 *
 * Knowing when somebody has finished speaking is the whole difference between
 * a dictation button and a conversation. Measuring loudness is not enough: in
 * a room with an engine coming out of the speakers, a wheel, a keyboard and
 * fans, a level threshold decides you are talking every couple of seconds —
 * and in hands-free mode that means sending noise to an agent on your behalf.
 * A real detector tells a voice from a noise; a meter cannot.
 *
 * That detector is a model plus a runtime, and together they are about
 * sixteen megabytes. They are NOT shipped in this package: most people
 * installing a voice plugin want to press a button and talk, and making all of
 * them carry sixteen megabytes for a mode they may never turn on is rude.
 *
 * So there are two ways they arrive, in this order:
 *
 *   1. a folder you already have, named in Settings — nothing is downloaded;
 *   2. a guided download, announced with its size, that you agree to.
 *
 * Either way the files are served back to the page from this same host, so the
 * browser fetches them from the harness and never from the internet.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * The six files the detector needs, and every one of them is needed.
 *
 * The names are fixed: the library asks for them by these exact names, so a
 * folder either has them or it does not. `ort.min.js` is the easy one to
 * forget — the detector's own bundle does NOT carry the inference runtime, it
 * expects to find it already on the page, and without it the model fails on a
 * property of undefined that names nothing.
 */
export const VAD_FILES = [
  { name: 'ort-wasm-simd-threaded.wasm', approxBytes: 13_961_845 },
  { name: 'ort-wasm-simd-threaded.mjs', approxBytes: 24_218 },
  { name: 'silero_vad_v5.onnx', approxBytes: 2_327_524 },
  { name: 'vad.worklet.bundle.min.js', approxBytes: 2_480 },
  { name: 'bundle.min.js', approxBytes: 69_143 },
  // The wasm-only build, on purpose: the full runtime is 368 KB and pulls a
  // second, larger set of wasm files for GPU backends this model will never
  // use. A voice-activity model runs on the processor in well under a
  // millisecond a frame.
  { name: 'ort.wasm.min.js', approxBytes: 50_196 },
];

/** Pinned on purpose: the four thresholds this plugin uses were measured
 *  against this version, and a silent upgrade would invalidate them. */
export const VAD_VERSION = '0.0.30';

/** The inference runtime, pinned to the build these files were taken from:
 *  the runtime's javascript and its wasm must be the same version or the
 *  model does not load. */
export const ORT_VERSION = '1.29.0';

const SOURCES = {
  'bundle.min.js': `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/bundle.min.js`,
  'vad.worklet.bundle.min.js': `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/vad.worklet.bundle.min.js`,
  'silero_vad_v5.onnx': `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/silero_vad_v5.onnx`,
  'ort.wasm.min.js': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.min.js`,
  'ort-wasm-simd-threaded.wasm': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm`,
  'ort-wasm-simd-threaded.mjs': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.mjs`,
};

/** Total weight, so the person is told the real number before agreeing. */
export const VAD_TOTAL_BYTES = VAD_FILES.reduce((n, f) => n + f.approxBytes, 0);

/** A file name from the list, never something a caller made up: these become
 *  paths, and a name is not a path. */
export function isKnownFile(name) {
  return VAD_FILES.some((f) => f.name === name);
}

/** Where a downloaded copy lives when the user has no folder of their own. */
export function cacheDir(baseDir) {
  return path.join(baseDir, 'dsh-kitt-voice', 'vad');
}

/**
 * Which folder actually has the files: the user's own if it is complete, the
 * downloaded cache otherwise. Returns null when neither is ready.
 */
export function resolveDir(userDir, baseDir) {
  for (const dir of [userDir, cacheDir(baseDir)]) {
    if (!dir) continue;
    const missing = VAD_FILES.some((f) => !fs.existsSync(path.join(dir, f.name)));
    if (!missing) return dir;
  }
  return null;
}

/** What is present and what is not, for a screen that has to explain itself. */
export function status(userDir, baseDir) {
  const ready = resolveDir(userDir, baseDir);
  const missing = VAD_FILES
    .filter((f) => !ready || !fs.existsSync(path.join(ready, f.name)))
    .map((f) => f.name);
  return {
    ready: Boolean(ready),
    from: ready === userDir && userDir ? 'folder' : ready ? 'downloaded' : '',
    // La ruta absoluta se queda aquí. Quien la necesita es este proceso, no la
    // página: a ella le basta con si está listo y qué falta.
    missing,
    totalBytes: VAD_TOTAL_BYTES,
  };
}

/**
 * Fetch whatever is missing into the cache.
 *
 * `onProgress(done, total)` is called as bytes land, because a sixteen
 * megabyte download with no sign of life reads as a hang. Every failure names
 * the file it failed on: "the download failed" tells nobody anything.
 */
export async function download(baseDir, onProgress, fetchImpl = globalThis.fetch) {
  const dir = cacheDir(baseDir);
  await fsp.mkdir(dir, { recursive: true });

  const pending = VAD_FILES.filter((f) => !fs.existsSync(path.join(dir, f.name)));
  const total = pending.reduce((n, f) => n + f.approxBytes, 0) || 1;
  let done = 0;

  for (const file of pending) {
    const url = SOURCES[file.name];
    if (!url) return { ok: false, reason: `No source is known for ${file.name}.` };

    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      return { ok: false, reason: `Could not reach the download for ${file.name}: ${error?.message ?? error}` };
    }
    if (!response.ok) {
      return { ok: false, reason: `The download for ${file.name} answered ${response.status}.` };
    }

    let bytes;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      return { ok: false, reason: `The download for ${file.name} broke midway: ${error?.message ?? error}` };
    }

    // Written beside and renamed, so an interrupted download never leaves a
    // half file that looks complete on the next start.
    const finalPath = path.join(dir, file.name);
    const tempPath = `${finalPath}.part`;
    try {
      await fsp.writeFile(tempPath, bytes);
      await fsp.rename(tempPath, finalPath);
    } catch (error) {
      return { ok: false, reason: `Could not save ${file.name}: ${error?.message ?? error}` };
    }

    done += file.approxBytes;
    try { onProgress?.(Math.min(done, total), total); } catch { /* progress must not break the download */ }
  }

  return { ok: true, dir };
}

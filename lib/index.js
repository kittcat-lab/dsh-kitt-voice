/**
 * dsh-kitt-voice — host half.
 *
 * Serves three jobs for the browser half:
 *
 *   - transcription: the page sends the raw webm it recorded, this half
 *     forwards it to Whisper (transcribe.js) and returns plain text. The
 *     recording is never decoded in the browser, because decoding audio in a
 *     Chromium renderer has been measured to freeze the whole window.
 *
 *   - voices + synthesis: this half lists the Piper voices the user already
 *     has and synthesises one reply chunk locally (speak.js). Nothing leaves
 *     the machine.
 *
 *   - the last assistant reply: this half taps the LLM stream and keeps the
 *     text of the most recent assistant turn per session, so the "read the
 *     last reply" button has something to say without the browser reaching
 *     into the conversation store.
 *
 * The transcription API key NEVER travels to the browser and never reaches a
 * log. It is read from the host environment at call time. The settings
 * namespace exposed to the browser holds only non-secret preferences
 * (language, prompt vocabulary, voices folder, chosen voice); the browser
 * learns whether a key is configured via a boolean in /config, not the key
 * itself. The settings scope contract I verified does not provide a
 * secret-masked field, so putting the key there would leak it to the client;
 * the environment is the one channel that cannot.
 */

import fs from 'node:fs';
import path from 'node:path';

import z from '@deepseek-ai/schemastery';

import { transcribe } from './transcribe.js';
import { findEngine, listVoices, synthesize } from './speak.js';
import { lastAssistantText } from './lastfromlog.js';
import { isNeuralVoice, synthesize as synthesizeNeural, listVoices as listNeuralVoices } from './neural.js';
import { createOverlay } from './overlay.js';
import { createFreshness } from './freshness.js';
import { guard } from './guard.js';
import { logRefused, logStartup, logNote } from './log.js';
import { resolveApiKey, describeApiKey } from './apikey.js';
import { isKnownFile, resolveDir, status as vadStatus, download as vadDownload } from './vad.js';
import { createPaginas, esArranque } from './paginas.js';

export const name = 'dsh-kitt-voice';
export const inject = ['webServer', 'settings', 'sessions', 'credentials'];

export const NS = 'dsh-kitt-voice';
export const BASE_PATH = '/dsh-kitt-voice';

/**
 * Whisper guidance vocabulary. A Spanish speaker drops English sim-racing
 * terms into the middle of Spanish sentences (setup, brake bias, understeer,
 * box, grip, stint). Without guidance Whisper writes them phonetically in
 * Spanish ("cetap", "breik baias") and the agent receives garbage. This is
 * the default prompt sent as Whisper's `prompt` field; it is editable in
 * Settings because the terms each team uses differ.
 *
 * Measured, not guessed: with this list, "setup", "understeer", "brake bias"
 * and "box" come back in English inside a Spanish sentence, and "clicks" —
 * which was missing — came back as "crits". A term that is not on this list
 * will be written phonetically, so adding one is the fix.
 */
export const DEFAULT_PROMPT_VOCAB =
  'setup, understeer, oversteer, brake bias, brake balance, box, pit box, ' +
  'grip, stint, tyre, tires, kerbs, apex, downforce, differential, gearbox, ' +
  'fuel, delta, lap, laps, qualifying, telemetry, camber, toe, caster, ' +
  'ride height, dampers, springs, anti-roll bar, wing, aero, traction, spin, ' +
  'clicks, click, psi, preload, splitter, diffuser, rake, lock-up, flat spot, ' +
  'trail braking, rotation, undercut, overcut, out-lap, in-lap, pace, ' +
  'fuel save, lift and coast, slipstream, tow, deg, stall, snap';

const MAX_BODY_BYTES = 24 * 1024 * 1024; // one webm utterance fits easily
const MAX_JSON_BODY = 16 * 1024;
/** Los tipos de audio que este plugin llega a grabar. Cualquier otra cosa
 *  se trata como el de siempre en vez de reenviarse tal cual. */
const TIPOS_DE_AUDIO = new Set([
  'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus',
  'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mp4', 'audio/mpeg',
]);

/** The one place the key is read. Never logged, never returned to the page. */
/** The only orders a companion window may give. Anything else is refused by
 *  name, so a typo fails loudly instead of doing nothing at all. */
const ORDERS = new Set(['record-toggle', 'talk-toggle', 'speak-last', 'stop-speaking', 'mic-mute']);

export const Config = z.object({
  enabled: z.boolean().default(true),
  sttProvider: z.string().default('browser'),
  apiKeyRef: z.string().default('GROQ_API_KEY'),
  language: z.string().default('auto'),
  promptVocab: z.string().default(DEFAULT_PROMPT_VOCAB),
  voicesDir: z.string().default(''),
  vadDir: z.string().default(''),
  micLabel: z.string().default(''),
  outputLabel: z.string().default(''),
  overlayAuto: z.boolean().default(false),
  electronPath: z.string().default(''),
  voice: z.string().default(''),
  speechRate: z.number().default(1),
  uiLang: z.string().default('auto'),
  buttonColours: z.string().default('color'),
});

/** Plain defaults (not a schema) so the settings schema and /config agree. */
const SETTINGS_DEFAULTS = {
  enabled: true,
  // The browser's own recogniser is the default on purpose: it needs no
  // account, no key and no download, so a new user can talk within seconds.
  // Anyone who wants better accuracy or full privacy switches in Settings.
  sttProvider: 'browser',
  // The harness keeps secrets in its own store; this names the entry that
  // holds the transcription key, so nobody has to create an environment
  // variable to say their first sentence.
  apiKeyRef: 'GROQ_API_KEY',
  language: 'auto',
  promptVocab: DEFAULT_PROMPT_VOCAB,
  voicesDir: '',
  // A folder that already holds the turn detector's files, if you have one.
  // Empty means: download them the first time hands-free is switched on.
  vadDir: '',
  // WHICH MICROPHONE AND WHICH SPEAKER, BY NAME.
  //
  // Not by device id. A browser gives every origin its OWN ids for the same
  // physical device, so an id chosen in one window means nothing in another —
  // and this plugin has two windows. The name is the same everywhere, so the
  // name is what gets stored, and the page finds the device that carries it.
  // Empty means whatever the system has as default.
  micLabel: '',
  outputLabel: '',
  // Open the floating window by itself the moment the voice is used. OFF by
  // default on purpose: starting a desktop process on somebody's machine
  // without being asked is not something a plugin gets to do.
  overlayAuto: false,
  // Which Electron to open it with. Empty means: whatever is beside the
  // window, or DSH_KITT_ELECTRON. Nothing is ever downloaded.
  electronPath: '',
  voice: '',
  // A QUÉ VELOCIDAD SE LEE. 1 es el ritmo natural de la voz.
  //
  // Escuchar no es leer: una respuesta larga en un ritmo que no es el tuyo se
  // sigue mal, y cada persona tiene el suyo. Se guarda como un número y cada
  // motor lo traduce a lo suyo, porque los tres lo llaman de forma distinta.
  speechRate: 1,
  // EN QUÉ IDIOMA HABLA LA APLICACIÓN. Distinto del idioma que se transcribe:
  // alguien puede dictar en español y querer los menús en inglés, y al revés.
  // 'auto' es el del sistema, que es lo que espera quien acaba de instalarlo.
  uiLang: 'auto',
  // Los mandos de la ventana: cada uno de su color, o todos en blanco para
  // quien quiera una barra que no cante nada encima de lo suyo. El borde
  // NO cambia en ningun caso: eso no es adorno, es el estado.
  buttonColours: 'color',
};

/** Los idiomas en los que está escrita la interfaz, en el orden de las listas
 *  de frases. El chino está porque el arnés es de DeepSeek: la mayoría de
 *  quien lo usa escribe en chino, y un plugin que no les habla no lo instalan. */
export const UI_LANGS = ['es', 'en', 'zh'];

/** El idioma de la interfaz, resuelto contra los que existen de verdad. */
export function safeUiLang(value) {
  const v = String(value || 'auto').trim().toLowerCase();
  if (v === 'auto') return 'auto';
  const base = v.split('-')[0];
  return UI_LANGS.includes(base) ? base : 'auto';
}

/** Los límites de la velocidad, en un solo sitio: el servidor y las dos
 *  pantallas tienen que estar de acuerdo o el ajuste miente. */
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;

/**
 * Un número de velocidad utilizable, venga de donde venga.
 *
 * Dos caminos distintos a propósito, y la diferencia importa:
 *
 *   - un número RAZONABLE que se pasa de los límites se recorta (0,1 quería
 *     decir «muy lento», así que se queda en el mínimo);
 *   - una CHORRADA —vacío, texto, cero, negativo, infinito— cae en el ritmo
 *     natural, no en el mínimo.
 *
 * La segunda regla está escrita porque la primera versión no la tenía y la
 * prueba la cazó: un ajuste vacío se convierte en cero, el cero es un número
 * finito, y se recortaba al mínimo. Resultado: la voz hablando lentísima de
 * repente, que suena a avería y que nadie relaciona con un ajuste que se
 * guardó mal.
 */
export function safeRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, n));
}

export function createSettingsSchema(defs) {
  const d = { ...SETTINGS_DEFAULTS, ...defs };
  return z.object({
    enabled: z.boolean().default(d.enabled),
    sttProvider: z.union([
      z.const('browser').description('Browser recognition — free, no account, no download (Chrome and Edge; audio passes through the browser vendor)'),
      z.const('groq').description('Groq Whisper — best accuracy and speed; needs your own API key in DSH_KITT_API_KEY'),
    ]).default(d.sttProvider).description(
      'Where speech is turned into text.'
    ),
    apiKeyRef: z.string().default(d.apiKeyRef).description(
      'Name of the harness credential holding the transcription key. The value is never shown here and never reaches the browser.'
    ),
    language: z.string().default(d.language).description(
      'Transcription language: "auto" lets Whisper detect it, or a plain ISO code like "es". ' +
      'A Spanish speaker saying English terms usually gets better results on "auto" plus the prompt vocabulary.'
    ),
    promptVocab: z.string().default(d.promptVocab).description(
      'Words Whisper should keep in English. Sim-racing terms spoken inside Spanish sentences are listed here so they are not written phonetically.'
    ),
    voicesDir: z.string().default(d.voicesDir).description(
      'Folder containing the Piper engine (piper/piper.exe) and one or more .onnx voice models.'
    ),
    micLabel: z.string().default(d.micLabel).description(
      'Which microphone, by name. Empty means the system default.'
    ),
    outputLabel: z.string().default(d.outputLabel).description(
      'Which speaker or headset the reply comes out of, by name. Empty means the system default.'
    ),
    overlayAuto: z.boolean().default(d.overlayAuto).description(
      'Open the floating window by itself when the voice is used, and close it with the harness.'
    ),
    electronPath: z.string().default(d.electronPath).description(
      'Which Electron opens the floating window. Leave empty to use one installed beside it, or DSH_KITT_ELECTRON.'
    ),
    vadDir: z.string().default(d.vadDir).description(
      'Folder holding the turn-detector files, if you already have them. Leave empty to download them once, with the size announced first.'
    ),
    voice: z.string().default(d.voice).description(
      'Chosen voice id (a .onnx file name). Pick a Spanish voice so Spanish replies sound natural.'
    ),
    speechRate: z.number().default(d.speechRate).description(
      'How fast the reply is read. 1 is the voice\'s natural pace; 0.5 is half speed and 2 is double. Applies to all three engines.'
    ),
  });
}

/** Write a small JSON response. */
function respondJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** Collect the raw request body as a Buffer (binary-safe; webm is opaque). */
function collectBody(req, res, maxBytes, onBody) {
  const chunks = [];
  let received = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) return;
    received += chunk.length;
    if (received > maxBytes) {
      tooLarge = true;
      respondJson(res, 413, { ok: false, reason: 'The recording is larger than expected.' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      const result = onBody(Buffer.concat(chunks));
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch {
      /* handled by the caller's own respondJson on its failure path */
    }
  });
  req.on('error', () => {});
}

/** Parse a query string value from req.url; empty string when absent. */
function queryParam(req, name) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    return url.searchParams.get(name) ?? '';
  } catch {
    return '';
  }
}

/**
 * Resolve the voice that will actually be used. The user preference wins when
 * it names a real model; otherwise we fall back to the first Spanish voice in
 * the folder, because reading Spanish replies with an English voice sounds
 * wrong in a way that no setting can fix. Only when there is no Spanish voice
 * at all do we take the first voice we find.
 */
function resolveVoice(voicesDir, preferred) {
  const voices = listVoices(voicesDir);
  if (!voices.length) return '';
  if (preferred && voices.some((v) => v.id === preferred)) return preferred;
  const spanish = voices.find((v) => v.language && v.language.toLowerCase().startsWith('es'));
  if (spanish) return spanish.id;
  return voices[0].id;
}

/**
 * Trim the LLM stream into a captured assistant reply, keeping the stream
 * flowing.
 *
 * Two things are kept, not one. `store` gets the finished reply, which is what
 * the speaker button reads. `live` gets the reply AS IT GROWS, which is what
 * lets the conversation read a long answer while the agent is still writing it
 * instead of leaving the person listening to silence for fifteen seconds.
 */
async function* captureReply(sessionId, inner, store, live, guardar) {
  let text = '';
  const empezado = Date.now();
  const anotar = (done) => {
    if (live) guardar(live, sessionId, { text, done, startedAt: empezado });
  };
  anotar(false);
  try {
    for await (const chunk of inner) {
      if (chunk && chunk.type === 'text-delta' && chunk.text) {
        text += chunk.text;
        anotar(false);
      }
      if (chunk && chunk.type === 'finish') {
        const trimmed = text.trim();
        if (trimmed) guardar(store, sessionId, trimmed);
        anotar(true);
      }
      yield chunk;
    }
  } finally {
    const trimmed = text.trim();
    if (trimmed) guardar(store, sessionId, trimmed);
    // Done means done, however the stream ended. A reader waiting for this
    // flag must never be left waiting because a turn was cancelled.
    anotar(true);
  }
}

export function apply(ctx, config) {
  // Detects the harness running an older copy of this plugin (see freshness.js).
  const freshness = createFreshness();
  const settingsScope = ctx.settings.register(
    NS,
    createSettingsSchema(config),
    { base: {
        enabled: config.enabled,
        language: config.language,
        promptVocab: config.promptVocab,
        voicesDir: config.voicesDir,
        voice: config.voice,
      } }
  );
  let vset = settingsScope.get();
  ctx.effect(() =>
    settingsScope.watch((next) => { vset = next; })
  );

  // The floating window. Opened when the voice is used, closed with the
  // harness: a window nobody launched is a window nobody knows how to close.
  const ventana = createOverlay({
    onNote: (message) => logNote(message),
  });
  ctx.effect(() => () => ventana.stop());

  /**
   * sessionId -> la última respuesta, y la que se está escribiendo.
   *
   * ACOTADOS. Guardaban una entrada por sesión y no borraban ninguna: en un
   * arnés encendido mucho tiempo, o con muchas sesiones, eso es memoria que
   * sólo sube. Se queda con las últimas; lo viejo no lo va a leer nadie, que
   * esto existe para leer en voz alta la respuesta de hace un momento.
   */
  const RESPUESTAS_QUE_SE_GUARDAN = 40;
  const recordar = (mapa, clave, valor) => {
    mapa.set(clave, valor);
    while (mapa.size > RESPUESTAS_QUE_SE_GUARDAN) {
      // Los Map recorren en orden de inserción, así que el primero es el más
      // viejo — salvo que se haya vuelto a escribir, que entonces es que se
      // está usando.
      const masVieja = mapa.keys().next().value;
      if (masVieja === clave) break;
      mapa.delete(masVieja);
    }
  };
  const lastReply = new Map();
  const liveReply = new Map();

  ctx.on('llm/stream', (options, next) => {
    const sessionId = options?.sessionId;
    if (!config.enabled || sessionId === undefined || options?.purpose !== undefined) return next();
    return captureReply(sessionId, next(), lastReply, liveReply, recordar);
  });

  const base = BASE_PATH;
  // El puerto real del arnés es lo que ata al guardián: sin él, «este mismo
  // servidor» se decide comparando dos cabeceras que escribe quien llama.
  const puertoDelArnes = Number(ctx.webServer.port);

  void describeApiKey(ctx, vset.apiKeyRef).then((keyInfo) => {
    logStartup({
      sttProvider: vset.sttProvider,
      hasKey: keyInfo.configured,
      keySource: keyInfo.source,
      voicesDir: vset.voicesDir,
      voiceCount: listVoices(vset.voicesDir).length,
    });
  });

  // GET /dsh-kitt-voice/config — non-secret preferences only.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/config`,
      handler: async (req, res) => {
        if (!guard(req, res, ['GET'], logRefused, puertoDelArnes)) return;
        const fresh = freshness.check();
        const voices = listVoices(vset.voicesDir);
        const resolvedVoice = isNeuralVoice(vset.voice)
          ? vset.voice
          : resolveVoice(vset.voicesDir, vset.voice);
        const keyInfo = await describeApiKey(ctx, vset.apiKeyRef);
        respondJson(res, 200, {
          ok: true,
          enabled: vset.enabled,
          sttProvider: vset.sttProvider,
          language: vset.language,
          promptVocab: vset.promptVocab,
          // La carpeta NO se le cuenta al navegador. La página no la necesita
          // —le basta con la lista de voces y con saber si hay motor— y una
          // ruta absoluta es el plano de la máquina servido gratis.
          hasVoicesDir: Boolean(vset.voicesDir),
          voice: vset.voice,
          resolvedVoice,
          voices,
          // La página necesita el ritmo porque la voz del sistema la lee ELLA,
          // no el servidor: sin esto, cambiar la velocidad no haría nada en la
          // única voz que funciona sin configurar nada.
          speechRate: safeRate(vset.speechRate),
          uiLang: safeUiLang(vset.uiLang),
          buttonColours: vset.buttonColours === 'sobrio' ? 'sobrio' : 'color',
          uiLangs: UI_LANGS,
          rateMin: RATE_MIN,
          rateMax: RATE_MAX,
          // Whether anything here can actually speak. The page needs to know
          // BEFORE it tries: when there is no engine it has a fallback of its
          // own, and showing a failure first would be a failure it can fix.
          speechEngine: isNeuralVoice(resolvedVoice) ? 'neural'
            : findEngine(vset.voicesDir) ? 'piper' : 'none',
          overlayAuto: vset.overlayAuto,
          micLabel: vset.micLabel,
          outputLabel: vset.outputLabel,
          port: ctx.webServer.port,
          apiKeyRef: vset.apiKeyRef,
          apiKeyConfigured: keyInfo.configured,
          apiKeySource: keyInfo.source,
          basePath: base,
          bootedAt: freshness.bootedAt,
          stale: fresh.stale,
          staleReason: fresh.reason,
        });
      },
    })
  );

  // POST /dsh-kitt-voice/transcribe — raw webm body, language + prompt in the query.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/transcribe`,
      handler: (req, res) => {
        if (!guard(req, res, ['POST'], logRefused, puertoDelArnes)) return;
        collectBody(req, res, MAX_BODY_BYTES, async (body) => {
          // Lo que viene en la dirección se acota antes de usarse. No es que se
          // pueda colar una cabecera —el formulario lo monta la librería— pero
          // un valor sin límite que se reenvía a un tercero es una puerta que
          // no hace falta dejar abierta.
          const pedido = String(queryParam(req, 'language') || '').slice(0, 8);
          const language = /^[A-Za-z-]{2,8}$/.test(pedido) ? pedido : (vset.language || '');
          const prompt = String(queryParam(req, 'prompt') || vset.promptVocab || '').slice(0, 2000);
          const tipo = String(queryParam(req, 'mime') || '');
          const mime = TIPOS_DE_AUDIO.has(tipo) ? tipo : 'audio/webm';
          try {
            const result = await transcribe({
              audio: body,
              mime,
              language: language === 'auto' ? '' : language,
              prompt,
              apiKey: (await resolveApiKey(ctx, vset.apiKeyRef)).key,
            });
            respondJson(res, result.ok ? 200 : 400, result);
          } catch (error) {
            // transcribe() already promises a { ok:false } result on every
            // failure path, but a thrown error must still reach the page as a
            // reason instead of leaving the request hanging.
            respondJson(res, 500, { ok: false, reason: 'Transcription failed unexpectedly: ' + String((error && error.message) || error) });
          }
        });
      },
    })
  );

  // POST /dsh-kitt-voice/speak — JSON { text, voice }; returns base64 wav.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/speak`,
      handler: (req, res) => {
        if (!guard(req, res, ['POST'], logRefused, puertoDelArnes)) return;
        collectBody(req, res, MAX_JSON_BODY, (body) => {
          let parsed = {};
          try { parsed = JSON.parse(String(body || '{}')); } catch { /* default below */ }
          // Acotado: un llamante directo no puede hacer que la máquina recite
          // dieciséis kilobytes seguidos. La página ya trocea por frases.
          const text = String(parsed.text || '').trim().slice(0, 2000);
          // The default voice is resolved server-side (Spanish first), so a
          // client that does not care about voices still gets a good one.
          const pedida = String(parsed.voice || vset.voice || '');
          const voice = isNeuralVoice(pedida) ? pedida : resolveVoice(vset.voicesDir, pedida);
          // El ritmo sale de los ajustes, y sólo se acepta de fuera si viene
          // acotado: un llamante no puede pedir que la máquina recite a
          // cincuenta veces la velocidad.
          const rate = safeRate(parsed.rate ?? vset.speechRate);
          if (!text) {
            respondJson(res, 400, { ok: false, reason: 'There was no reply text to read.' });
            return;
          }
          // One name decides which engine speaks. A neural voice is named
          // «es-ES-ElviraNeural» and a Piper one «es_ES-davefx-medium»: the
          // shapes cannot be confused, so nothing else has to be configured.
          if (isNeuralVoice(voice)) {
            void synthesizeNeural({ text, voice, rate })
              .then((result) => respondJson(res, result.ok ? 200 : 400, result))
              // Sin esto, algo que reviente por sorpresa deja la petición
              // colgada para siempre y una promesa rechazada sin dueño.
              .catch((error) => respondJson(res, 500, {
                ok: false, reason: `The neural voice failed: ${error?.message ?? error}`,
              }));
            return;
          }
          void synthesize({ text, voice, voicesDir: vset.voicesDir, rate })
            .catch((error) => ({ ok: false, reason: `Synthesis failed: ${error?.message ?? error}` }))
            .then((result) => respondJson(res, result.ok ? 200 : 400,
              // Said out loud rather than assumed by the page: Piper returns
              // wav, the neural voice returns mp3, and a player told the wrong
              // one plays nothing at all.
              result.ok ? { ...result, audioBase64: result.wavBase64, mime: 'audio/wav' } : result));
        });
      },
    })
  );

  // GET /dsh-kitt-voice/last?sessionId=... — the last assistant text of that session.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/last`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET'], logRefused, puertoDelArnes)) return;
        const sessionId = queryParam(req, 'sessionId');

        // ?live=1 — the reply as it stands right now, finished or not. Asked
        // for repeatedly while the agent writes, so it answers with whatever
        // it has and says whether more is coming.
        if (queryParam(req, 'live') === '1') {
          const growing = sessionId ? liveReply.get(sessionId) : undefined;
          if (growing) {
            respondJson(res, 200, { ok: true, text: growing.text, done: growing.done });
            return;
          }
          // NOTHING UNDER THAT NAME. Sending can open a new session, so the
          // reply may be growing under an id the asker has never seen. With a
          // `since` it is safe to hand over the newest one that STARTED after
          // the question was asked: it cannot be somebody else's older answer,
          // and the alternative is telling the person nothing came back while
          // the answer sits on their screen.
          const since = Number(queryParam(req, 'since') || 0);
          if (since > 0) {
            let mejor = null;
            for (const entrada of liveReply.values()) {
              if (entrada.startedAt >= since && (!mejor || entrada.startedAt > mejor.startedAt)) mejor = entrada;
            }
            if (mejor) {
              respondJson(res, 200, { ok: true, text: mejor.text, done: mejor.done, moved: true });
              return;
            }
          }
          const finished = sessionId ? lastReply.get(sessionId) : undefined;
          respondJson(res, 200, { ok: true, text: finished || '', done: true });
          return;
        }

        // What streamed past while this process has been up, and failing that
        // the session's own log — so a restart does not make a reply that is
        // plainly on screen unreadable.
        const text = sessionId
          ? (lastReply.get(sessionId) || lastAssistantText(ctx.sessions, sessionId))
          : undefined;
        if (!text) {
          // Con un CÓDIGO, no sólo con una frase. La frase de aquí está en
          // inglés y acababa saliendo tal cual en una barra que habla español;
          // y además esto no es una avería —todavía no hay nada que leer, y ya
          // está—, así que quien lo enseñe tiene que poder distinguirlo de un
          // fallo de verdad.
          respondJson(res, 404, {
            ok: false,
            code: 'no-reply',
            reason: 'There is no reply to read yet for this session.',
          });
          return;
        }
        respondJson(res, 200, { ok: true, text });
      },
    })
  );

  // --- Live state, so a window OUTSIDE the browser can show what is going on.
  //
  // The page owns the voice turn, but the point of this plugin is talking to
  // the agent while you are somewhere else entirely — in a game, in an editor.
  // A web page cannot float over a fullscreen game; a desktop window can. So
  // the page publishes its state here and any companion window reads it.
  // Kept in memory on purpose: it is a live signal, worthless a second later.
  let liveState = { mode: 'idle', message: null, caption: null, at: 0 };
  /** Cuantas veces se ha pedido que la ventana abra su menu. Vive FUERA de
   *  liveState porque la pagina reescribe ese objeto entero en cada cambio y
   *  se llevaria el recado por delante. */
  let menuSeq = 0;

  /* QUÉ PÁGINA MANDA. Con el arnés abierto en dos sitios, las dos publicaban
   * estado y las dos recibían cada tecla. Ver lib/paginas.js. */
  const paginas = createPaginas();

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/state`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET', 'POST'], logRefused, puertoDelArnes)) return;
        if (String(req.method).toUpperCase() === 'GET') {
          respondJson(res, 200, { ok: true, ...liveState, menuSeq });
          return;
        }
        collectBody(req, res, MAX_JSON_BODY, (body) => {
          let parsed = {};
          try { parsed = JSON.parse(String(body || '{}')); } catch { /* defaults below */ }
          const page = String(parsed.page || '').slice(0, 64);

          // La persona ha traído esta página al frente: si nadie está usando
          // la voz, las teclas pasan a ser suyas. No es un estado.
          if (parsed.focus) {
            paginas.foco(page);
            respondJson(res, 200, { ok: true });
            return;
          }

          const nuevo = {
            mode: String(parsed.mode || 'idle'),
            level: Number(parsed.level) || 0,
            message: parsed.message ? String(parsed.message) : null,
            caption: parsed.caption ? String(parsed.caption) : null,
            at: Date.now(),
            conversation: Boolean(parsed.conversation),
            // El micrófono silenciado a mano. La ventana flotante tiene que
            // poder encender su botón: desde fuera, un micrófono que no
            // reacciona y uno silenciado se ven igual.
            muted: Boolean(parsed.muted),
          };

          // El reposo de una página que no manda no pisa el estado de la que
          // sí: la ventana flotante pintaba una y otra a saltos.
          if (!paginas.estado(page, nuevo)) {
            respondJson(res, 200, { ok: true, ignored: true });
            return;
          }

          /* LA VENTANA SE ABRE SOLA AL ARRANCAR LA VOZ, Y SÓLO ENTONCES.
           *
           * Se abría en cada estado activo, y eso hacía inútil su aspa: la
           * cerrabas a mitad de conversación y el siguiente cambio de estado,
           * medio segundo después, la volvía a lanzar — a veces perdiendo el
           * cerrojo de instancia única contra la que aún se estaba cerrando,
           * que es por lo que unas veces «se cerraba» y otras no. Ahora se
           * abre al pasar de parada a en uso; cerrada a mano, se queda cerrada
           * hasta la próxima vez que se empiece a usar la voz, o hasta que se
           * pida desde el engranaje. */
          if (vset.overlayAuto && esArranque(liveState, nuevo)) {
            ventana.ensure({ electronPath: vset.electronPath, port: ctx.webServer.port });
          }

          liveState = nuevo;
          respondJson(res, 200, { ok: true });
        });
      },
    })
  );

  // --- Orders coming the other way -----------------------------------------
  //
  // State flows page -> host -> companion. This is the return path, and it is
  // the reason the whole thing exists: a button on a steering wheel fires a
  // global shortcut in the companion window, which leaves an order here, and
  // the page picks it up and starts recording. Without it you would have to
  // find the browser to talk, which defeats the purpose.
  //
  // A counter rather than a queue: only the latest order matters, and a page
  // that was closed for a minute must not replay a minute of button presses.
  //
  // Y CON DESTINATARIA: la orden lleva el nombre de la página que manda, y
  // las demás la ven pasar sin hacer nada. Vacía cuando ninguna tiene nombre.
  let order = { seq: 0, name: '', at: 0, page: '' };

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/command`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET', 'POST'], logRefused, puertoDelArnes)) return;
        if (String(req.method).toUpperCase() === 'GET') {
          respondJson(res, 200, { ok: true, ...order });
          return;
        }
        collectBody(req, res, MAX_JSON_BODY, (body) => {
          let parsed = {};
          try { parsed = JSON.parse(String(body || '{}')); } catch { /* defaults below */ }
          const name = String(parsed.name || '').trim();

          /* ABRIR LA VENTANA FLOTANTE. Es la única orden que NO va a la página:
           * la ventana la lanza este proceso, así que aquí se atiende y aquí se
           * acaba. Empujársela al navegador sería mandarle un recado que no
           * puede cumplir. */
          if (name === 'overlay-open') {
            const abierta = ventana.ensure({ electronPath: vset.electronPath, port: ctx.webServer.port });
            /* Y QUE ABRA SU MENÚ, no sólo que exista.
             *
             * «Asegurar la ventana» no hace nada visible cuando ya está
             * abierta, que es casi siempre: se pulsaba el engranaje y no
             * pasaba nada. Lo que se pide de verdad es el panel de opciones.
             *
             * Va por un contador y no por una orden de las normales porque las
             * normales viajan a la PÁGINA, y esto es un recado para la ventana.
             * Ella lo ve en el estado que ya consulta cada 150 ms: cuando el
             * número cambia, abre. Un número y no un booleano para que dos
             * peticiones seguidas se noten como dos. */
            menuSeq += 1;
            respondJson(res, abierta ? 200 : 503, abierta
              ? { ok: true }
              : { ok: false, reason: 'The companion window could not be opened. Check electronPath in Settings.' });
            return;
          }

          if (!ORDERS.has(name)) {
            respondJson(res, 400, { ok: false, reason: `Unknown order "${name}".` });
            return;
          }
          order = { seq: order.seq + 1, name, at: Date.now(), page: paginas.destinataria() };
          empujar(order);
          respondJson(res, 200, { ok: true, seq: order.seq });
        });
      },
    })
  );

  // --- The turn detector's files ------------------------------------------
  //
  // Served from here rather than fetched by the page from a CDN: the page
  // should only ever have to talk to its own harness, and a plugin that makes
  // the browser reach the internet on its own is a plugin nobody can audit.
  const vadBase = () => {
    // NOT taken from the harness context. Cordis refuses even to *read* a
    // property that was not declared in `inject`, and the refusal arrives as a
    // thrown error inside the request — a bare 400 with no words. The home
    // folder is already in the environment; that is where it is read from.
    const home = process.env.DSH_HOME;
    if (typeof home === 'string' && home) return home;
    return process.cwd();
  };

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/vad/status`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET'], logRefused, puertoDelArnes)) return;
        // A handler that throws is answered by the harness with a bare 400 and
        // no words at all, which is the hardest kind of fault to chase. This
        // one says what went wrong instead.
        try {
          respondJson(res, 200, { ok: true, ...vadStatus(vset.vadDir, vadBase()) });
        } catch (error) {
          respondJson(res, 200, {
            ok: false,
            ready: false,
            reason: `The detector's folder could not be read: ${error?.message ?? error}`,
          });
        }
      },
    })
  );

  let bajando = null;   // one download at a time, and its progress

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/vad/download`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET', 'POST'], logRefused, puertoDelArnes)) return;
        if (String(req.method).toUpperCase() === 'GET') {
          respondJson(res, 200, { ok: true, ...(bajando || { running: false }) });
          return;
        }
        if (bajando?.running) { respondJson(res, 200, { ok: true, ...bajando }); return; }
        bajando = { running: true, done: 0, total: 1, reason: '' };
        void vadDownload(vadBase(), (done, total) => { bajando = { running: true, done, total, reason: '' }; })
          .then((r) => { bajando = { running: false, done: 1, total: 1, reason: r.ok ? '' : r.reason }; })
          .catch((e) => { bajando = { running: false, done: 0, total: 1, reason: String(e?.message ?? e) }; });
        respondJson(res, 200, { ok: true, running: true, done: 0, total: 1 });
      },
    })
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      // No trailing slash: the harness documents prefix paths as absolute and
      // slashless, and a slash here matches nothing at all — silently, with the
      // fallback's bare 404, which looks exactly like a missing file.
      path: `${base}/vad/file`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET'], logRefused, puertoDelArnes)) return;
        // Una dirección mal escrita —«%E0%A4%A»— hace reventar al decodificador,
        // y una ruta que revienta contesta el 400 pelado sin una palabra: justo
        // el fallo que en esta casa cuesta más de encontrar.
        let asked = '';
        try {
          asked = decodeURIComponent(String(req.url || '').split('?')[0].split('/').pop() || '');
        } catch {
          respondJson(res, 400, { ok: false, reason: 'That file name is not readable.' });
          return;
        }
        // Only names from the known list ever become a path. A file name is
        // not a path, and this is the only place that rule can be enforced.
        if (!isKnownFile(asked)) { respondJson(res, 404, { ok: false, reason: 'Unknown file.' }); return; }
        const dir = resolveDir(vset.vadDir, vadBase());
        if (!dir) { respondJson(res, 404, { ok: false, reason: 'The turn detector is not installed yet.' }); return; }
        const full = path.join(dir, asked);
        let bytes;
        try { bytes = fs.readFileSync(full); }
        catch { respondJson(res, 404, { ok: false, reason: 'That file is missing from the detector folder.' }); return; }
        const type = asked.endsWith('.wasm') ? 'application/wasm'
          : asked.endsWith('.onnx') ? 'application/octet-stream'
          : 'text/javascript';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(bytes);
      },
    })
  );

  // --- Orders, PUSHED to the page ------------------------------------------
  //
  // The whole point of this plugin is talking to the agent while you are
  // somewhere else — in a game, with the browser behind everything. And that
  // is exactly the situation in which a browser stops being a reliable place
  // to keep a clock: a backgrounded tab's timers are slowed to once a second,
  // and after a few minutes to once a MINUTE. A wheel button that takes up to
  // a minute to open the microphone is a wheel button that does not work.
  //
  // So the order is not asked for; it is pushed. The route is held open and
  // the server writes down it. A network callback is not a timer and is not
  // throttled. Polling stays as a fallback for a page whose stream never
  // opened.
  const abiertos = new Set();

  const empujar = (orden) => {
    const linea = `data: ${JSON.stringify(orden)}\n\n`;
    for (const res of abiertos) {
      try { res.write(linea); } catch { abiertos.delete(res); }
    }
  };

  ctx.effect(() => {
    // A comment every twenty seconds. Nothing reads it: it exists so that a
    // proxy or a sleeping socket does not quietly drop a connection that looks
    // idle, which would leave the keys dead with nothing to show for it.
    const latido = setInterval(() => {
      for (const res of abiertos) {
        try { res.write(': .\n\n'); } catch { abiertos.delete(res); }
      }
    }, 20000);
    return () => {
      clearInterval(latido);
      for (const res of abiertos) { try { res.end(); } catch { /* going anyway */ } }
      abiertos.clear();
    };
  });

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/orders`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET'], logRefused, puertoDelArnes)) return;
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          // Buffering an event stream defeats the entire point of it.
          'x-accel-buffering': 'no',
        });
        // The seq it already knows about, so a page that reconnects does not
        // replay an order it has already carried out.
        res.write(`data: ${JSON.stringify({ seq: order.seq, name: '', hello: true })}\n\n`);
        abiertos.add(res);
        // Quién es: por aquí se sabe qué páginas hay abiertas ahora mismo.
        const page = queryParam(req, 'page').slice(0, 64);
        paginas.conectar(page);

        // A held-open connection dies in more ways than it closes. When the
        // other end vanishes, node raises 'error' on the socket, and an
        // 'error' with nobody listening does not fail the request — it takes
        // the WHOLE HARNESS down. Measured, the hard way: closing a test
        // connection killed the server with nothing in the log.
        // Una sola vez por conexión, aunque lleguen los cuatro avisos.
        let suelto = false;
        const soltar = () => {
          if (suelto) return;
          suelto = true;
          abiertos.delete(res);
          paginas.desconectar(page);
        };
        req.on('close', soltar);
        req.on('error', soltar);
        res.on('close', soltar);
        res.on('error', soltar);
      },
    })
  );

  // --- What is plugged in, and changing what is chosen ---------------------
  //
  // Only the page can see the machine's microphones and speakers: a browser
  // will not tell anyone else. So the page says what it found, this remembers
  // it, and the floating window — which cannot ask the browser anything — can
  // finally offer a choice instead of sending everybody back to a text file.
  let aparatos = { inputs: [], outputs: [], at: 0 };

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/devices`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET', 'POST'], logRefused, puertoDelArnes)) return;
        if (String(req.method).toUpperCase() === 'GET') {
          respondJson(res, 200, { ok: true, ...aparatos });
          return;
        }
        collectBody(req, res, MAX_JSON_BODY, (body) => {
          let parsed = {};
          try { parsed = JSON.parse(String(body || '{}')); } catch { /* defaults below */ }
          // Names only, and a bounded number of them: this comes from a page,
          // and a page is not a place to take an unbounded list from.
          const limpiar = (lista) => (Array.isArray(lista) ? lista : [])
            .map((x) => String(x || '').slice(0, 120))
            .filter(Boolean)
            .slice(0, 32);
          aparatos = {
            inputs: limpiar(parsed.inputs),
            outputs: limpiar(parsed.outputs),
            at: Date.now(),
          };
          respondJson(res, 200, { ok: true });
        });
      },
    })
  );

  // Which settings anything outside may change. An allowlist, because this
  // route is reachable by the floating window and a route that can write any
  // setting can write the one that names a folder.
  const CAMBIABLES = new Set(['micLabel', 'outputLabel', 'voice', 'language', 'sttProvider', 'overlayAuto', 'speechRate', 'uiLang', 'buttonColours']);

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/settings`,
      handler: (req, res) => {
        if (!guard(req, res, ['POST'], logRefused, puertoDelArnes)) return;
        collectBody(req, res, MAX_JSON_BODY, (body) => {
          let parsed = {};
          try { parsed = JSON.parse(String(body || '{}')); } catch { /* defaults below */ }
          const patch = {};
          for (const [clave, valor] of Object.entries(parsed)) {
            if (!CAMBIABLES.has(clave)) continue;
            // La velocidad es un NÚMERO acotado. Guardada como texto, el
            // esquema la rechaza y el ajuste se pierde sin decir nada.
            if (clave === 'speechRate') { patch[clave] = safeRate(valor); continue; }
            if (clave === 'uiLang') { patch[clave] = safeUiLang(valor); continue; }
            // Dos valores y no más: es un interruptor, no un texto libre. Sin
            // esto se podía guardar cualquier cosa y luego el que la lee tiene
            // que adivinar qué significa «azul» en un ajuste de dos posiciones.
            if (clave === 'buttonColours') {
              patch[clave] = String(valor) === 'sobrio' ? 'sobrio' : 'color';
              continue;
            }
            patch[clave] = typeof valor === 'boolean' ? valor : String(valor ?? '').slice(0, 200);
          }
          if (!Object.keys(patch).length) {
            respondJson(res, 400, { ok: false, reason: 'Nothing here can be changed.' });
            return;
          }
          void settingsScope.update(patch)
            .then(() => respondJson(res, 200, { ok: true, changed: Object.keys(patch) }))
            .catch((error) => respondJson(res, 500, { ok: false, reason: String(error?.message ?? error) }));
        });
      },
    })
  );

  // GET /dsh-kitt-voice/voices — every voice that can speak, from both engines.
  //
  // The page could not build this on its own: the local ones are files on this
  // machine and the neural ones come from a service. Both are asked for here so
  // that whoever shows a list — the settings card, or the floating window that
  // cannot ask the browser anything — shows the same one.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${base}/voices`,
      handler: (req, res) => {
        if (!guard(req, res, ['GET'], logRefused, puertoDelArnes)) return;
        const locales = listVoices(vset.voicesDir);
        void listNeuralVoices()
          .then((neuronales) => respondJson(res, 200, {
            ok: true,
            local: locales,
            neural: neuronales,
          }))
          .catch(() => respondJson(res, 200, { ok: true, local: locales, neural: [] }));
      },
    })
  );
}

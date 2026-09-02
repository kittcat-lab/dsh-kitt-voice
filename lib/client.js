/**
 * dsh-kitt-voice — browser half.
 *
 * Adds three pieces to the web UI:
 *
 *   - a microphone button in the composer tool row (`conversation.input.right`).
 *     Press to record, press again to stop. The transcribed text lands in the
 *     message box as a draft; it is never sent on its own.
 *
 *   - a speaker button next to it that reads the last assistant reply aloud
 *     and stops it when pressed again.
 *
 *   - a status line under the composer (`conversation.input.dock`) that is
 *     always visible: listening · transcribing · reading · error, each with a
 *     reason when something failed. Nothing ever fails silently.
 *
 * It also registers a settings card under `settings.plugin.item`, keyed by the
 * same namespace the host owns, so the user edits the preferences in the
 * harness Settings UI.
 *
 * The hard-won rules, learned from plugins that shipped and froze:
 *
 *   1. The webm recorded by MediaRecorder goes to the host RAW. It is never
 *      decoded in the page: decodeAudioData in a Chromium renderer freezes the
 *      whole window.
 *
 *   2. Recording uses MediaRecorder; metering uses AnalyserNode. Never
 *      ScriptProcessorNode: it also freezes and couples mic to speaker.
 *
 *   3. While the reply is being read, the microphone is covered. Browser echo
 *      cancellation does not cover our own synthesised voice; if the mic stays
 *      open the app hears itself and loops. Pressing the mic while reading
 *      stops the reading first and reopens the ear half a second later.
 *
 *   4. Every failure reports its reason in the status line. Never silent.
 *
 * The file is hand-written in the wrapper shape the harness expects: a
 * single `window.__ModuleLoader__.load({ id, factory })`. No bundler step is
 * required for this project.
 */

window.__ModuleLoader__.load({
  id: 'dsh-kitt-voice',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const { useState, useEffect, useRef, useCallback } = React;

    var inject = ['slots', 'sessions', 'settingsScope'];

    const BASE_PATH = '/dsh-kitt-voice';
    const REOPEN_MIC_MS = 500;

    /* ---------------------------------------------------------------- *
     * Tiny shared state bus. One object, plain listeners. The three UI
     * pieces subscribe and re-render; nothing else needs to know about it.
     * ---------------------------------------------------------------- */

    /**
     * Which microphone to speak into, and which speaker to hear the reply from.
     *
     * On a sim rig these are almost never the same device, and they change by
     * the day: the headset mic while the sound goes to the VR goggles, or a
     * desk mic while the reply comes out of Bluetooth headphones because
     * someone else is on a call in the room. Guessing is wrong often enough to
     * be useless, so the person picks.
     *
     * Kept in this browser rather than in the plugin settings on purpose: a
     * device id only means something on the machine that produced it.
     */
    /** How often the page asks whether a key was pressed outside the browser.
     *  Fast enough that a wheel button feels immediate, slow enough to be
     *  invisible on loopback. */

    /**
     * Load the turn detector once, from our own host.
     *
     * The library is a classic script, not a module: with context isolation it
     * cannot be imported by name, so it goes in as a <script> tag and leaves
     * itself on `window`. The model and its runtime are fetched from the
     * harness too — this page never reaches the internet on its own.
     */
    let vadCargando = null;

    /** One <script> tag, awaited. */
    function meterScript(name) {
      return new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = `${location.origin}${BASE_PATH}/vad/file/${name}`;
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error(`${name} could not be loaded`));
        document.head.appendChild(tag);
      });
    }

    function cargarDetector() {
      if (window.vad && window.vad.MicVAD) return Promise.resolve(window.vad);
      if (vadCargando) return vadCargando;
      vadCargando = (async () => {
        // ORDER MATTERS, and getting it wrong is silent: the detector's bundle
        // does not carry the inference runtime, it looks for one already on the
        // page. Load it second and the model dies reading a property of
        // undefined, with nothing in the message to say which property.
        if (!window.ort) await meterScript('ort.wasm.min.js');
        await meterScript('bundle.min.js');
        if (!(window.vad && window.vad.MicVAD)) {
          throw new Error('the detector loaded but exposed nothing');
        }
        return window.vad;
      })().catch((error) => { vadCargando = null; throw error; });
      return vadCargando;
    }

    /** Ask the host whether the detector's files are here, and get them if not. */
    async function asegurarDetector(bus) {
      const estado = await fetch(`${location.origin}${BASE_PATH}/vad/status`).then((r) => r.json());
      if (estado.ready) return true;

      const megas = Math.round((estado.totalBytes || 0) / 1e6);
      bus.set({ mode: 'transcribing', message: `${t(L.vadDownloading)} (${megas} MB)`, caption: null });
      await fetch(`${location.origin}${BASE_PATH}/vad/download`, { method: 'POST' });

      // Watched rather than awaited: sixteen megabytes with no sign of life
      // reads as a hang, so the progress is shown while it lands.
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const paso = await fetch(`${location.origin}${BASE_PATH}/vad/download`).then((r) => r.json());
        if (paso.reason) { bus.set({ mode: 'error', message: paso.reason }); return false; }
        if (!paso.running) break;
        const pct = Math.round((paso.done / (paso.total || 1)) * 100);
        bus.set({ message: `${t(L.vadDownloading)} ${pct}%` });
      }
      const fin = await fetch(`${location.origin}${BASE_PATH}/vad/status`).then((r) => r.json());
      if (!fin.ready) { bus.set({ mode: 'error', message: t(L.vadFailed) }); return false; }
      return true;
    }


    /**
     * The voice every machine already has.
     *
     * Piper sounds better and never leaves the machine, but it has to be
     * installed, and somebody who just added this plugin has not installed
     * anything. Windows ships three Spanish voices, macOS and the Linux
     * desktops ship their own; the browser hands them over for free. So the
     * plugin speaks from the first minute, and Piper becomes an improvement
     * rather than a requirement.
     *
     * What this cannot do, and the reason it is the second choice: it will not
     * play through a chosen output device — the browser gives no way to route
     * it — so on a rig with two sound cards it comes out of the default one.
     */
    function elegirVozDelSistema(idioma) {
      const todas = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      if (!todas.length) return null;
      // The setting is a language code or 'auto'; 'auto' means Spanish here,
      // because that is the language this plugin exists for.
      const quiere = (!idioma || idioma === 'auto') ? 'es' : String(idioma).slice(0, 2).toLowerCase();
      const delIdioma = todas.filter((v) => String(v.lang || '').slice(0, 2).toLowerCase() === quiere);
      // A local voice over a network one: the network ones stall when the
      // connection does, and this is meant to work mid-race.
      return delIdioma.find((v) => v.localService) || delIdioma[0] || null;
    }

    /**
     * A QUÉ RITMO SE LEE, para todo el módulo.
     *
     * Los otros dos motores lo reciben del servidor, pero la voz del sistema la
     * pronuncia ESTA página, así que aquí hace falta el número. Vive suelto y
     * no dentro de un componente porque quien lee es una función suelta, y
     * porque las dos partes de la interfaz —la barra de escribir y el botón de
     * escuchar— tienen que leer al mismo ritmo o parecen dos productos.
     */
    let ritmoDeLectura = 1;

    /** El ritmo que diga el servidor, acotado igual que allí. */
    function fijarRitmo(valor) {
      const n = Number(valor);
      if (Number.isFinite(n)) ritmoDeLectura = Math.min(2, Math.max(0.5, n));
    }

    /** Read `texto` with the system voice. Resolves when it has finished. */
    function leerConElSistema(texto, idioma, onStart) {
      return new Promise((resolve, reject) => {
        if (!window.speechSynthesis) { reject(new Error('this browser has no built-in voice')); return; }
        const frase = new SpeechSynthesisUtterance(String(texto || ''));
        const voz = elegirVozDelSistema(idioma);
        if (voz) { frase.voice = voz; frase.lang = voz.lang; }
        frase.rate = ritmoDeLectura;
        frase.onend = () => resolve();
        frase.onerror = (e) => {
          // Being stopped is not a failure: it is the stop button doing its
          // job. Chrome reports 'canceled' for one that never started and
          // 'interrupted' for one cut off mid-sentence — pressing stop while
          // it speaks gives the second, and calling that an error puts a red
          // line on the screen for doing exactly what was asked.
          const parado = e && (e.error === 'canceled' || e.error === 'interrupted');
          if (parado) resolve();
          else reject(new Error((e && e.error) || 'the built-in voice failed'));
        };
        // Chrome drops anything queued before a previous cancel has settled.
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(frase);
        if (onStart) onStart(voz ? voz.name : '');
      });
    }


    /* ---------------------------------------------------------------- *
     * Speaking. ONE way to do it, used by the button and by the
     * conversation, because two ways drift apart and then one of them is
     * quietly worse than the other.
     * ---------------------------------------------------------------- */

    /**
     * LO QUE NO SE PRONUNCIA — y por qué esto vive aquí.
     *
     * Un agente escribe para una pantalla: asteriscos, almohadillas, viñetas,
     * flechas, emojis, cajas de dibujar tablas. En alto eso no es decoración,
     * es ruido, y cada motor lo destroza a su manera: uno nombra el emoji
     * entero, otro suelta un chasquido, otro se atasca y corta la frase.
     *
     * Estaba escrito en `chunk.js` y NUNCA se llamaba: el troceador de ese
     * fichero no lo usa nadie del camino vivo. Medido — se le oyeron leer los
     * asteriscos. Así que se limpia aquí, en la ÚNICA puerta por la que pasa
     * todo lo que se lee, sea la voz del sistema, Piper o la neuronal.
     *
     * Lo que sólo es dibujo se va; lo que significa algo se dice como lo diría
     * un lector: una viñeta es una pausa, una flecha es «a», una raya larga es
     * una pausa. La puntuación de verdad y los números no se tocan.
     */
    const SOLO_DIBUJO = new RegExp(
      '[' +
      '\\u{1F000}-\\u{1FAFF}' +   // emojis, fichas, símbolos suplementarios
      '\\u{1F1E6}-\\u{1F1FF}' +   // las letras que forman banderas
      '\\u{2600}-\\u{27BF}' +     // símbolos varios y dingbats
      '\\u{2B00}-\\u{2BFF}' +     // flechas y formas sueltas
      '\\u{2500}-\\u{257F}' +     // cajas de dibujar tablas
      '\\u{FE00}-\\u{FE0F}' +     // el selector que pone «esto en color»
      '\\u{200D}' +               // el pegamento entre emojis
      ']', 'gu');

    const SE_DICEN = [
      [/[→⇒➔➜➞➡]/g, ' a '],
      [/[←⇐⬅]/g, ' desde '],
      [/[—–]/g, ', '],
      [/[•·▪◦‣]/g, ', '],
      [/[«»“”„‟]/g, '"'],
      [/[‘’‚‛]/g, "'"],
      [/…/g, '. '],
      [/[✓✔]/g, ' sí '],
      [/[✗✘×]/g, ' no '],
    ];

    /* ------------------------------------------------------------------ *
     * LOS DOS TONOS DE LA LLAMADA.
     *
     * Abrir la conversación y colgarla son las dos cosas que pasan cuando NO
     * estás mirando la pantalla — que es justo para lo que existe todo esto.
     * Sin un sonido, la única forma de saber si te está escuchando es hablar y
     * esperar a ver qué pasa, y eso convierte cada turno en una apuesta.
     *
     * Dos notas y nada más, como un telefonillo: SUBE al abrir, BAJA al
     * colgar. La dirección es el mensaje —abierto o cerrado— y se entiende sin
     * haberlo aprendido.
     *
     * Generados aquí, no un fichero: dos notas son cuatro líneas de código y
     * cero bytes que descargar, y así el paquete no engorda por un pitido.
     * ------------------------------------------------------------------ */

    /** Dos notas seguidas, en la salida elegida si el navegador deja. */
    async function tono(subiendo) {
      let ctx;
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        ctx = new Audio();
        // Al volumen de un aviso, no de una alarma: esto suena encima de lo
        // que estés haciendo.
        const notas = subiendo ? [660, 990] : [660, 440];
        const ahora = ctx.currentTime;
        notas.forEach((hz, i) => {
          const osc = ctx.createOscillator();
          const vol = ctx.createGain();
          // Seno: un tono limpio no rasca. Y una entrada y salida suaves,
          // porque un tono que empieza y acaba de golpe hace «clic».
          osc.type = 'sine';
          osc.frequency.value = hz;
          const t0 = ahora + i * 0.1;
          vol.gain.setValueAtTime(0, t0);
          vol.gain.linearRampToValueAtTime(0.16, t0 + 0.015);
          vol.gain.linearRampToValueAtTime(0, t0 + 0.11);
          osc.connect(vol).connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.13);
        });
        // El contexto se cierra solo cuando las notas han sonado: dejarlo
        // abierto es una pestaña que retiene el aparato de audio para siempre.
        await new Promise((r) => setTimeout(r, 320));
      } catch { /* un aviso que no suena no puede tumbar la conversación */ }
      finally { try { if (ctx) await ctx.close(); } catch { /* ya cerrado */ } }
    }

    /** Se abre la llamada. */
    const tonoAbrir = () => { void tono(true); };
    /** Se cuelga. */
    const tonoColgar = () => { void tono(false); };

    /** El texto tal como hay que decirlo. Vacío si no queda nada que decir. */
    function paraLeer(texto) {
      let limpio = String(texto ?? '')
        .replace(/```[\s\S]*?```/g, ' bloque de código ')
        .replace(/`/g, '')
        .replace(/[*#_]/g, '');

      for (const [patron, dicho] of SE_DICEN) limpio = limpio.replace(patron, dicho);
      limpio = limpio.replace(SOLO_DIBUJO, ' ');

      // Lo quitado deja huecos y comas huérfanas: una línea que era «✅ Hecho»
      // no puede acabar siendo « , Hecho».
      limpio = limpio
        .replace(/[ \t]{2,}/g, ' ')
        // Espacios, NUNCA saltos de línea: un `\s` aquí se comía el salto de
        // una lista y pegaba los puntos unos con otros. Medido.
        .replace(/[ \t]+([,.;:!?])/g, '$1')
        .replace(/([,;:])[ \t]*(?=[,.;:!?])/g, '')
        .replace(/^[ \t]*[,;:][ \t]*/gm, '');

      /* LOS SALTOS DE LÍNEA NO SE LEEN, SE RESPIRAN.
       *
       * Un salto de línea llega hasta la voz tal cual, y ahí cada uno es un
       * silencio largo. Una respuesta con una lista de seis puntos se leía a
       * trompicones: frase, parón, frase, parón — y eso, escuchando, no suena a
       * lista: suena a que se ha colgado.
       *
       * Así que una línea que ya termina en puntuación sólo necesita un
       * espacio, y una que no termina en nada se cierra con una coma, que es la
       * pausa corta que haría cualquiera al leer una lista en alto. Las líneas
       * en blanco de separación se van: no aportan nada al oído. */
      return limpio
        .replace(/\n{2,}/g, '\n')
        .replace(/([^\s.!?:;,])[ \t]*\n/g, '$1, ')
        .replace(/[ \t]*\n[ \t]*/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    }

    /** Whatever is making noise right now, so it can be silenced from anywhere. */
    let sonando = null;

    /** Stop the voice, whichever of the two is speaking. */
    function callar() {
      const antes = sonando;
      sonando = null;
      if (antes && antes.parar) { try { antes.parar(); } catch { /* already quiet */ } }
      if (window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch { /* nothing queued */ }
      }
    }

    /**
     * Say `texto` and resolve when it has finished — or when it was stopped,
     * which is not a failure.
     *
     * `motor` is what the host reported: 'piper' when there is an engine
     * installed, anything else when there is not. With Piper it asks the host
     * to synthesise; without it, or if that fails, it uses the voice the
     * machine already has. Returns how it was actually read, so the caller can
     * say so on screen rather than guessing.
     */
    async function hablarTexto(texto, { motor, idioma }) {
      const dicho = paraLeer(texto);
      if (!dicho) return 'nada';

      if (motor === 'piper' || motor === 'neural') {
        try {
          const res = await fetch(`${location.origin}${BASE_PATH}/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: dicho }),
          });
          const data = await res.json().catch(() => ({}));
          if (data && data.ok && (data.audioBase64 || data.wavBase64)) {
            await reproducir(data.audioBase64 || data.wavBase64, data.mime || 'audio/wav');
            return 'motor';
          }
        } catch { /* fall through: being unable to speak is the real failure */ }
      }
      await leerConElSistema(dicho, idioma);
      return 'sistema';
    }

    /** Play one piece of synthesised audio through the chosen output. */
    async function reproducir(audioBase64, mime) {
      // Resolved BEFORE the promise: looking the device up is asynchronous and
      // a promise executor cannot wait for anything.
      const salida = await idDeAparato('output');
      return new Promise((resolve, reject) => {
        const audio = new Audio(`data:${mime || 'audio/wav'};base64,${audioBase64}`);
        const arrancar = () => {
          sonando = { parar() { try { audio.pause(); audio.currentTime = 0; } catch { /* stopped */ } resolve(); } };
          audio.onended = () => { sonando = null; resolve(); };
          audio.onerror = () => { sonando = null; reject(new Error('the audio could not be played')); };
          audio.play().catch(reject);
        };
        // Not every browser can route audio to a chosen device. Where it
        // cannot, the reply still plays on the default one rather than going
        // silent.
        if (salida && typeof audio.setSinkId === 'function') {
          audio.setSinkId(salida).then(arrancar, arrancar);
        } else {
          arrancar();
        }
      });
    }

    /**
     * Cut the finished sentences off the front of a growing text.
     *
     * Returns [what can be spoken now, what has to wait]. A sentence is only
     * handed over once its ending is there: reading half a sentence and then
     * pausing sounds like a fault, not like speech.
     */
    function frasesEnteras(texto) {
      // A full stop only ends a sentence when something blank follows it:
      // otherwise «brake bias 54.5» is read as «cincuenta y cuatro punto» and
      // then stops dead, which sounds like a fault rather than like speech. A
      // line break ends one on its own, whatever comes after.
      const corte = /(?:[.!?…:](?=\s|$)|\n)/g;
      let fin = -1;
      let m;
      while ((m = corte.exec(texto)) !== null) fin = m.index;
      if (fin === -1) return ['', texto];
      return [texto.slice(0, fin + 1), texto.slice(fin + 1)];
    }

    /**
     * Read the reply while the agent is still writing it.
     *
     * Long answers used to be read only once complete, which on a fifteen
     * second answer is fifteen seconds of silence with nothing to say what is
     * happening. This asks the host for the reply as it stands, hands each
     * finished sentence to the voice, and stops when the host says there is no
     * more coming.
     *
     * `sigueVivo()` is asked constantly: when the conversation is closed
     * mid-answer, everything stops at the end of the current sentence.
     */
    async function leerSegunLlega(sesionAhora, { motor, idioma, sigueVivo, alEmpezar, anterior }) {
      // `sesionAhora` is a FUNCTION, not an id.
      //
      // Sending can open a new session — the harness decides that, not us — and
      // the id this was called with then belongs to a conversation that will
      // never answer. Asked once, this waits two minutes and reports that the
      // agent said nothing, with the answer sitting on the screen behind it.
      // Measured: that is exactly what happened.
      const idDe = () => (typeof sesionAhora === 'function' ? sesionAhora() : sesionAhora);

      let pendiente = '';
      let visto = '';           // the whole text as it stood on the last look
      let dijoAlgo = false;
      let calladoDesde = 0;     // when the agent last said it had finished
      const desde = Date.now();

      // THERE IS NO CLOCK ON THE AGENT.
      //
      // There used to be, and it was wrong twice over: an agent that goes and
      // reads the sim's memory takes as long as it takes, and a window that
      // turns red for that teaches you to ignore the colour. Waiting is not a
      // failure. This waits while the conversation is open and stops when the
      // person stops it — which is the only thing that should ever stop it.

      // A TURN IS MANY STEPS. The agent thinks, calls a tool, reads what came
      // back, and carries on — and every one of those is a stream that starts
      // and finishes. So «finished» on its own means nothing: the first step of
      // an agent that goes looking for something produces a tool call and no
      // words at all, and taking that as the end reported that the agent had
      // not answered while it was busy answering. Measured live: it did exactly
      // that, twenty-three seconds into a job.
      //
      // So finishing is only believed after a quiet spell with nothing new.
      const CALLADO_BASTA_MS = 2500;

      while (sigueVivo()) {
        let paso;
        try {
          const res = await fetch(
            `${location.origin}${BASE_PATH}/last?live=1&since=${desde}` +
            `&sessionId=${encodeURIComponent(idDe() || '')}`,
            { cache: 'no-store' });
          paso = await res.json();
        } catch (error) {
          // Y se DICE. Antes se salía del bucle sin más y desde fuera eso es
          // una conversación que se calla y vuelve al reposo sin explicación.
          bus.set({ mode: 'error', message: `${t(L.hostGone)}: ${error?.message ?? error}`, level: 0 });
          break;
        }
        const entero = String((paso && paso.text) || '');

        // THE NEW TURN HAS NOT STARTED YET. Between sending and the model's
        // first word, what the host still holds is the PREVIOUS reply, marked
        // finished. Reading that would have the agent calmly repeating its last
        // answer to a question it has not heard yet.
        if (!dijoAlgo && anterior && entero === anterior) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        // Each step starts its own text from nothing, so what arrives can be
        // SHORTER than what came before. Comparing lengths would then miss the
        // new step entirely; comparing the text itself does not.
        if (entero.length < visto.length || !entero.startsWith(visto)) visto = '';
        pendiente += entero.slice(visto.length);
        visto = entero;

        const terminado = Boolean(paso && paso.done);
        if (terminado) {
          if (!calladoDesde) calladoDesde = Date.now();
        } else {
          calladoDesde = 0;
        }
        // Only a finish that has held quiet for a moment is a real ending —
        // AND ONLY ONCE SOMETHING HAS BEEN SAID.
        //
        // Watched live: the agent thought for 7.8 seconds on a turn whose
        // first step was a tool call and no words, the quiet spell ran out,
        // and the ear reopened without reading a thing. Nothing said means the
        // turn has not started, whatever any single stream claims about being
        // finished. There is no clock here; stopping is what a person does.
        const deVerdadTerminado = dijoAlgo && terminado && calladoDesde
          && (Date.now() - calladoDesde) >= CALLADO_BASTA_MS;

        // Once it really has finished there is nothing left to wait for, so the
        // tail goes out whole even if it never ended in a full stop.
        const [ahora, resto] = deVerdadTerminado ? [pendiente, ''] : frasesEnteras(pendiente);
        pendiente = resto;

        if (ahora.trim()) {
          if (!dijoAlgo && alEmpezar) alEmpezar();
          dijoAlgo = true;
          calladoDesde = 0;   // it spoke, so the quiet spell starts again
          await hablarTexto(ahora, { motor, idioma });
          if (!sigueVivo()) break;
          continue;   // more may have arrived while we were talking
        }
        if (deVerdadTerminado) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      return dijoAlgo;
    }

    /** Shared by the two controls in this file, and by nothing else: the
     *  conversation button lives beside the microphone but the loop belongs to
     *  the microphone, which owns the audio. */
    const micBridge = {};

    const ORDER_POLL_MS = 300;

    /**
     * The turn detector's settings.
     *
     * These four are the library's own defaults, verified against its
     * frame-processor source rather than copied from a blog. They were then
     * used in anger for a day in this house before being written down. Do not
     * change one without a measurement in front of you: `redemptionMs` is the
     * silence that ends your sentence, and shaving it cuts people off
     * mid-thought.
     */
    const VAD_SETTINGS = {
      model: 'v5',
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      minSpeechMs: 400,
      redemptionMs: 1400,
    };

    /**
     * WHICH DEVICE, BY NAME.
     *
     * It used to be by id, kept in this page's own storage, and that was wrong
     * for two reasons that only show up once there is a second window: a
     * browser hands every origin DIFFERENT ids for the same physical device,
     * so an id chosen in the floating window means nothing here; and a choice
     * kept in this page is a choice nothing else can read or change — which is
     * how you end up with a plugin only its author can configure.
     *
     * So the name is stored in the harness, where both windows can reach it,
     * and the id is looked up here, at the moment it is used.
     */
    const nombreDeAparato = { input: '', output: '' };

    /** The id of the device carrying this name, or '' for the system default. */
    async function idDeAparato(which) {
      const querido = nombreDeAparato[which];
      if (!querido) return '';
      const kind = which === 'input' ? 'audioinput' : 'audiooutput';
      let todos = [];
      try { todos = await navigator.mediaDevices.enumerateDevices(); } catch { return ''; }
      const suyos = todos.filter((d) => d.kind === kind && d.deviceId);
      // Exact first. Failing that, a device whose name starts the same way:
      // Windows renames the tail of a device when it is re-plugged, and losing
      // your microphone because of that is not a thing anybody should debug.
      const exacto = suyos.find((d) => d.label === querido);
      if (exacto) return exacto.deviceId;
      // Compared with the accents taken out. «Micrófono (TONOR…)» written by a
      // tool that mangled the ó becomes a name that matches nothing, and losing
      // your microphone to a broken accent is not something anybody should have
      // to work out. Dropping every non-ascii character makes both sides equal.
      const plano = (t) => String(t || '').replace(/[^\x20-\x7E]/g, '').toLowerCase().trim();
      const igual = suyos.find((d) => plano(d.label) === plano(querido));
      if (igual) return igual.deviceId;
      const parecido = suyos.find((d) => d.label && plano(querido).startsWith(plano(d.label).slice(0, 20)));
      return parecido ? parecido.deviceId : '';
    }

    /** Tell the host what is plugged in, so the floating window can offer it. */
    async function contarAparatos() {
      try {
        const todos = await navigator.mediaDevices.enumerateDevices();
        const nombres = (kind) => todos
          .filter((d) => d.kind === kind && d.label)
          .map((d) => d.label);
        await fetch(`${location.origin}${BASE_PATH}/devices`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ inputs: nombres('audioinput'), outputs: nombres('audiooutput') }),
        });
      } catch { /* the window will offer nothing, and say so */ }
    }

    /** List microphones and speakers. Labels stay empty until the person has
     *  granted microphone access once — that is a browser rule, not a bug, and
     *  the settings card says so instead of showing a list of blank entries. */
    async function listDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { inputs: [], outputs: [] };
      let all = [];
      try { all = await navigator.mediaDevices.enumerateDevices(); } catch { return { inputs: [], outputs: [] }; }
      const pick = (kind) => all
        .filter((device) => device.kind === kind && device.deviceId)
        .map((device) => ({ id: device.deviceId, label: device.label || '' }));
      return { inputs: pick('audioinput'), outputs: pick('audiooutput') };
    }

    function createBus() {
      const listeners = new Set();
      let state = {
        mode: 'idle', // idle | listening | transcribing | reading | error
        message: null, // human reason, always shown when mode === 'error'
        caption: null, // live transcription while listening, or reply while reading
        level: 0, // current mic level 0..1 while listening
        reading: false, // is the speaker currently playing?
        conversation: false, // hands-free: listen, send, read, listen again
        coverMicUntil: 0, // timestamp until which the mic must stay covered
        /* EL MICRÓFONO, SILENCIADO A MANO.
         *
         * Distinto de «callar», que apaga la voz que te habla. Esto cierra el
         * oído: mientras está puesto, ni la conversación escucha ni el
         * micrófono graba. Hace falta cuando estás en otra aplicación y va a
         * entrar alguien a hablarte, o cuando pones un vídeo.
         *
         * Lo lleva el estado y no un cierre local porque la barra flotante
         * tiene que poder verlo y encender su botón: desde fuera, un micrófono
         * que no reacciona y un micrófono silenciado se ven igual, y esa duda
         * es exactamente la que no puede tener quien no está mirando. */
        muted: false,
      };
      // The companion window lives outside the browser and cannot see this
      // state, so every change is published to the host for it to read. Fire
      // and forget: a companion that is not running must never slow the page,
      // and only the fields it draws are sent — no draft text, no audio.
      let lastPublished = '';
      let lastLevelAt = 0;
      const publish = (next) => {
        // The level moves every animation frame. Sending that would be a
        // request per frame, so it rides at ten per second — enough for the
        // companion to move with the real voice, cheap enough to ignore.
        const now = Date.now();
        const level = next.mode === 'listening' ? Math.round((next.level || 0) * 100) / 100 : 0;
        // `conversation` viaja tambien: la ventana flotante tiene que poder
        // encender su boton mientras el sistema esta en marcha, y no puede
        // saberlo de ninguna otra forma.
        const wire = JSON.stringify({ mode: next.mode, message: next.message, caption: next.caption, level,
          conversation: Boolean(next.conversation), muted: Boolean(next.muted) });
        const onlyLevelChanged = wire.replace(/,"level":[\d.]+/, '') === lastPublished.replace(/,"level":[\d.]+/, '');
        if (wire === lastPublished) return;
        if (onlyLevelChanged && now - lastLevelAt < 100) return;
        if (onlyLevelChanged) lastLevelAt = now;
        lastPublished = wire;
        try {
          void fetch(`${location.origin}${BASE_PATH}/state`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: wire,
            keepalive: true,
          }).catch(() => { /* no companion, no problem */ });
        } catch { /* no companion, no problem */ }
      };

      const set = (patch) => {
        state = { ...state, ...patch };
        for (const fn of listeners) {
          try { fn(state); } catch { /* a broken listener must not kill the rest */ }
        }
        publish(state);
      };
      // Orders arrive from outside the browser (a wheel button firing a global
      // shortcut in the companion window). Each component says which order it
      // answers; the poller below delivers it. Only the newest order counts —
      // a page that was closed must not replay a minute of button presses.
      const handlers = new Map();
      let lastOrderSeq = -1;

      /** Carry out one order, wherever it came from. */
      function atender(orden) {
        if (!orden || typeof orden.seq !== 'number') return;
        if (lastOrderSeq < 0) { lastOrderSeq = orden.seq; return; } // never act on history
        if (orden.seq === lastOrderSeq) return;
        lastOrderSeq = orden.seq;
        // Todos los interesados, no el último que se apuntó.
        for (const handler of handlers.get(orden.name) || []) {
          try { handler(); } catch { /* one bad order is not fatal */ }
        }
      }

      // ORDERS ARE PUSHED, not asked for. This plugin exists to be used with
      // the browser behind a game, and a backgrounded tab's timers are slowed
      // to once a second and then to once a MINUTE. A wheel button that takes
      // a minute to open the microphone does not work. A held-open stream is
      // not a timer, so it is not slowed.
      let flujo = null;
      const abrirFlujo = () => {
        try {
          flujo = new EventSource(`${location.origin}${BASE_PATH}/orders`);
          flujo.onmessage = (e) => {
            try { atender(JSON.parse(e.data)); } catch { /* not an order */ }
          };
          // The browser reconnects an EventSource on its own; nothing to do.
        } catch { flujo = null; }   // the poll below still covers us
      };
      abrirFlujo();

      // The floating window cannot ask the browser what is plugged in — no
      // window can ask another. So this one says, once at the start and again
      // whenever a headset appears or a Bluetooth device connects.
      void contarAparatos();
      // Guardada para poder quitarla: una escucha que se pone y no se quita es
      // una fuga, y este bus se tira y se vuelve a crear cada vez que el
      // plugin se recarga.
      const alCambiarAparatos = () => { void contarAparatos(); };
      const medios = navigator.mediaDevices;
      if (medios && medios.addEventListener) {
        medios.addEventListener('devicechange', alCambiarAparatos);
      }

      async function pollOrders() {
        // Kept as a fallback for a page whose stream never opened. NOT skipped
        // when the tab is hidden: hidden is the normal case here.
        try {
          const response = await fetch(`${location.origin}${BASE_PATH}/command`, { cache: 'no-store' });
          atender(await response.json());
        } catch { /* no host, no orders */ }
      }
      const orderTimer = setInterval(pollOrders, ORDER_POLL_MS);

      return {
        getState: () => state,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        // Reloading a plugin must not leave a timer polling forever behind it.
        dispose: () => {
          clearInterval(orderTimer);
          if (medios && medios.removeEventListener) {
            medios.removeEventListener('devicechange', alCambiarAparatos);
          }
          if (flujo) { try { flujo.close(); } catch { /* closed already */ } flujo = null; }
          handlers.clear();
          listeners.clear();
        },
        // Trigger an order locally, the same one a wheel button would send.
        // The conversation loop uses it to hand the reply to whoever owns the
        // audio instead of duplicating that code.
        ask: (name) => {
          for (const handler of handlers.get(name) || []) {
            try { handler(); } catch { /* one order is not the loop */ }
          }
        },
        /**
         * UNA ORDEN PUEDE TENER VARIOS INTERESADOS.
         *
         * Guardaba uno por nombre, así que el último que se apuntaba borraba al
         * anterior — en silencio. Y pasaba de verdad: «callar» lo escuchan dos
         * piezas, la que corta el audio y la que corta la espera del ciclo, y
         * sólo quedaba viva una. El botón parecía funcionar un instante y la voz
         * seguía con la frase siguiente.
         */
        onOrder: (name, fn) => {
          if (!handlers.has(name)) handlers.set(name, new Set());
          handlers.get(name).add(fn);
          return () => {
            const suyos = handlers.get(name);
            if (!suyos) return;
            suyos.delete(fn);
            if (!suyos.size) handlers.delete(name);
          };
        },
        set,
      };
    }

    /* ---------------------------------------------------------------- *
     * Strings for the user. Spanish first, then English, then Chinese.
     * ---------------------------------------------------------------- */
    const L = {
      // Los rótulos dicen QUÉ PASA AL PULSAR, no cómo se llama el botón, y son
      // los mismos que en la ventana flotante: es el mismo mando en dos sitios.
      micTitle: [
        'Push to talk — pulsa, habla, y pulsa otra vez para enviar',
        'Push to talk — press, speak, press again to send',
        '按键说话 — 按一次开始，说完再按一次发送',
      ],
      micRecord: ['Hablar', 'Speak', '说话'],
      micMute: [
        'Silenciar el micrófono — deja de escucharte hasta que lo quites',
        'Mute the microphone — it stops listening until you unmute',
        '静音麦克风 — 取消静音前不再聆听',
      ],
      micUnmute: [
        'Micrófono silenciado — pulsa para volver a escuchar',
        'Microphone muted — press to listen again',
        '麦克风已静音 — 点击以恢复聆听',
      ],
      muted: ['Silenciado', 'Muted', '已静音'],
      optionsTitle: [
        'Opciones — abre la ventana flotante: micrófono, voz, velocidad, idioma y teclas',
        'Options — opens the companion window: microphone, voice, speed, language and keys',
        '选项 — 打开悬浮窗：麦克风、语音、语速、语言与快捷键',
      ],
      micStop: ['Parar', 'Stop', '停止'],
      speakTitle: ['Leer los mensajes', 'Read the messages', '朗读消息'],
      speakStop: ['Callar', 'Stop reading', '停止朗读'],
      listening: ['Escuchando…', 'Listening…', '正在聆听…'],
      transcribing: ['Transcribiendo…', 'Transcribing…', '正在转写…'],
      reading: ['Leyendo…', 'Reading…', '正在朗读…'],
      systemVoice: ['Leyendo con la voz del sistema', 'Reading with the built-in voice', '正在用系统语音朗读'],
      systemVoiceInstead: ['Leído con la voz del sistema.', 'Read with the built-in voice instead.', '已改用系统语音朗读。'],
      idle: ['Voz', 'Voice', '语音'],
      noReply: ['Aún no hay respuesta que leer', 'No reply to read yet', '暂无回复可朗读'],
      micCovered: ['El micrófono se reabre en un momento…', 'The microphone reopens in a moment…', '麦克风即将重新开启…'],
      noMic: ['No se pudo acceder al micrófono', 'Could not access the microphone', '无法访问麦克风'],
      noAudio: ['No se grabó nada', 'Nothing was recorded', '未录制到声音'],
      noBrowserStt: [
        'Este navegador no sabe reconocer voz. Usa Chrome o Edge, o elige Groq en los ajustes.',
        'This browser cannot recognise speech. Use Chrome or Edge, or pick Groq in Settings.',
        '此浏览器不支持语音识别。请使用 Chrome 或 Edge，或在设置中选择 Groq。',
      ],
      sttFailed: ['No se pudo transcribir', 'Could not transcribe', '转写失败'],
      thinking: ['Pensando…', 'Thinking…', '正在思考…'],
      hostGone: ['Se ha perdido la conexión con el arnés',
                 'Lost the connection to the harness',
                 '与 Harness 的连接已断开'],
      micLost: ['La conversación sigue encendida pero el micrófono no ha vuelto a abrirse',
                'The conversation is still on but the microphone did not reopen',
                '对话仍在继续，但麦克风未能重新开启'],
      vadDownloading: ['Bajando el detector de voz', 'Downloading the turn detector', '正在下载语音检测器'],
      vadFailed: [
        'No se pudo preparar el detector de voz. Mira los ajustes del plugin.',
        'The turn detector could not be prepared. Check the plugin settings.',
        '无法准备语音检测器。请检查插件设置。',
      ],
      talkStart: [
        'Modo KITT — conversación continua, sin tocar nada más',
        'KITT mode — hands-free conversation, nothing else to press',
        'KITT 模式 — 免提连续对话，无需再按任何键',
      ],
      talkStop: ['Terminar el modo KITT', 'End KITT mode', '结束 KITT 模式'],
      cannotSend: [
        'Esta pantalla no deja enviar por su cuenta. Abre una conversación y vuelve a intentarlo.',
        'This screen does not allow sending on its own. Open a conversation and try again.',
        '此页面无法自行发送。请打开一个会话后重试。',
      ],
      micDenied: [
        'El navegador no da permiso para el micrófono. Dáselo en el candado de la barra de direcciones.',
        'The browser is refusing microphone access. Allow it from the padlock in the address bar.',
        '浏览器未授予麦克风权限。请在地址栏的锁形图标中开启。',
      ],
      sttNetwork: [
        'El reconocimiento del navegador no pudo conectar. Prueba con Groq en los ajustes.',
        'Browser recognition could not connect. Try Groq in Settings.',
        '浏览器语音识别无法连接。请在设置中尝试使用 Groq。',
      ],
      noSttInApp: [
        'Dentro de esta aplicación el reconocimiento del navegador no funciona. Guarda una clave de Groq en el arnés y elige Groq en los ajustes.',
        'Browser recognition does not work inside this desktop app. Store a Groq key in the harness and pick Groq in Settings.',
        '在此应用中浏览器语音识别不可用。请先在 Harness 中保存 Groq API 密钥，并在设置中选择 Groq。',
      ],
      switchedToKeyed: ['Uso Groq: aquí dentro el del navegador no vale', 'Using Groq: browser recognition does not work in here', '已改用 Groq：此环境中浏览器识别不可用'],
      noKey: [
        'Groq está elegido pero no encuentro su clave. Guárdala en el arnés como GROQ_API_KEY, o cambia a reconocimiento del navegador en los ajustes.',
        'Groq is selected but its key was not found. Store it in the harness as GROQ_API_KEY, or switch to browser recognition in Settings.',
        '已选择 Groq，但未找到其密钥。请在 Harness 中以 GROQ_API_KEY 保存，或在设置中切换回浏览器识别。',
      ],
      talkNeedsKey: [
        'La conversación transcribe por el arnés y necesita la clave de Groq. Guárdala en el arnés como GROQ_API_KEY — el botón de hablar sí funciona sin clave.',
        'The conversation transcribes through the harness and needs the Groq key. Store it in the harness as GROQ_API_KEY — the speak button works without one.',
        '连续对话由 Harness 转写，需要 Groq 密钥。请在 Harness 中以 GROQ_API_KEY 保存——说话按钮无需密钥即可使用。',
      ],
      settingsTitle: ['Voz (DSH KITT)', 'Voice (DSH KITT)', '语音（DSH KITT）'],
      language: ['Idioma de transcripción', 'Transcription language', '转写语言'],
      languageAuto: ['automático', 'automatic', '自动'],
      promptVocab: ['Palabras que deben quedar en inglés', 'Words to keep in English', '需保留为英文的词汇'],
      voicesDir: ['Carpeta de voces de Piper', 'Piper voices folder', 'Piper 语音文件夹'],
      voice: ['Voz', 'Voice', '语音'],
      inputDevice: ['Micrófono', 'Microphone', '麦克风'],
      outputDevice: ['Salida de sonido', 'Sound output', '声音输出'],
      deviceDefault: ['El que use Windows', "Whatever Windows uses", '系统默认'],
      deviceNames: [
        'Los nombres aparecen después de dar permiso al micrófono una vez.',
        'Device names appear after you allow microphone access once.',
        '授予麦克风权限后才会显示设备名称。',
      ],
      keyMissing: ['Falta la clave de transcripción en el almacén del arnés', 'Transcription key is missing from the harness credential store', 'Harness 凭据库中缺少转写密钥'],
      loading: ['Cargando…', 'Loading…', '正在加载…'],
    };
    /* ------------------------------------------------------------------ *
     * EN QUÉ IDIOMA HABLA ESTO.
     *
     * Las frases de arriba son listas: [español, inglés, chino]. Esto elegía
     * SIEMPRE la primera, así que las inglesas llevaban escritas desde el
     * primer día sin que las viera nadie — un bilingüe de mentira. Medido.
     *
     * El chino está porque el arnés es de DeepSeek y la mayoría de quien lo
     * usa escribe en chino: un plugin que no les habla no lo instalan.
     *
     * Una frase que todavía no está traducida cae al inglés, y si tampoco, al
     * español. Nunca se enseña un hueco: media interfaz en blanco es peor que
     * media interfaz en otro idioma.
     * ------------------------------------------------------------------ */
    const IDIOMAS_UI = ['es', 'en', 'zh'];
    let idiomaUI = 'es';

    /** El idioma pedido, o el del navegador si nadie ha pedido ninguno. */
    function fijarIdiomaUI(pedido) {
      const p = String(pedido || 'auto').toLowerCase();
      const cual = (p === 'auto' || !p)
        ? String(navigator.language || 'es').slice(0, 2).toLowerCase()
        : p.split('-')[0];
      idiomaUI = IDIOMAS_UI.includes(cual) ? cual : 'en';
    }

    const t = (arr) => {
      if (!Array.isArray(arr)) return String(arr ?? '');
      const i = IDIOMAS_UI.indexOf(idiomaUI);
      return arr[i] || arr[1] || arr[0] || '';
    };

    /* ---------------------------------------------------------------- *
     * Reusable tiny components (all React.createElement, no JSX).
     * ---------------------------------------------------------------- */
    function label(text) {
      return React.createElement('span', { style: { fontSize: 12, color: '#8a8f98' } }, text);
    }

    function textField(labelText, value, onChange, placeholder) {
      return React.createElement('label', { style: { display: 'block', margin: '6px 0' } },
        label(labelText),
        React.createElement('input', {
          type: 'text',
          value,
          placeholder: placeholder || '',
          onChange: (e) => onChange(e.target.value),
          style: { width: '100%', boxSizing: 'border-box', marginTop: 2, padding: '4px 6px' },
        })
      );
    }

    function selectField(labelText, value, options, onChange) {
      return React.createElement('label', { style: { display: 'block', margin: '6px 0' } },
        label(labelText),
        React.createElement('select', {
          value,
          onChange: (e) => onChange(e.target.value),
          style: { width: '100%', marginTop: 2, padding: '4px 6px' },
        },
          options.map((opt) =>
            React.createElement('option', { key: opt.value, value: opt.value }, opt.label)
          )
        )
      );
    }

    /* ---------------------------------------------------------------- *
     * Settings card. Reads/writes the host namespace through the scope the
     * harness binds; never sees the API key (the host keeps it in its env).
     * ---------------------------------------------------------------- */
    function SettingsCard({ scope }) {
      const [, force] = useState(0);
      // The voices folder and its contents come from the host /config; the
      // settings namespace only holds the plain-string preferences. Fetch it
      // once when the card mounts so the voice selector has real options.
      const [voices, setVoices] = useState([]);
      const [devices, setDevices] = useState({ inputs: [], outputs: [] });

      // Devices come and go — a headset is plugged in, Bluetooth connects — so
      // the list is refreshed whenever the browser says it changed.
      useEffect(() => {
        let alive = true;
        const refresh = () => { void listDevices().then((found) => { if (alive) setDevices(found); }); };
        refresh();
        const media = navigator.mediaDevices;
        if (media && media.addEventListener) media.addEventListener('devicechange', refresh);
        return () => {
          alive = false;
          if (media && media.removeEventListener) media.removeEventListener('devicechange', refresh);
        };
      }, []);

      useEffect(() => {
        let alive = true;
        void fetch(`${location.origin}${BASE_PATH}/config`)
          .then((res) => res.json().catch(() => ({})))
          .then((data) => { if (alive && Array.isArray(data && data.voices)) setVoices(data.voices); })
          .catch(() => { /* the selector just stays empty */ });
        return () => { alive = false; };
      }, []);
      useEffect(() => scope.subscribe(() => force((x) => x + 1)), [scope]);

      const snap = scope.getSnapshot();
      const val = snap.value || {};

      if (snap.status !== 'ready') {
        return React.createElement('div', {},
          label(snap.status === 'unavailable' ? 'Ajustes no disponibles / Settings unavailable' : t(L.loading)));
      }

      const set = (field, value) => { void scope.set(field, value); };
      const languageOptions = [
        { value: 'auto', label: t(L.languageAuto) },
        { value: 'es', label: 'Español' },
        { value: 'en', label: 'English' },
      ];
      const voiceOptions = voices.map((v) => ({ value: v.id, label: `${v.id} (${v.language})` }));

      // The chosen voice decides how Spanish replies sound. An English voice
      // reading Spanish is the one failure we can prevent in the UI, so warn
      // when the selection is not Spanish (an English voice reading Spanish
      // sounds wrong; a Spanish voice reading the odd English term is normal).
      const chosenVoice = val.voice || '';
      const chosenVoiceLang = chosenVoice ? String(chosenVoice.split('-')[0] || '').replace('_', '-') : '';
      const voiceNotSpanish = chosenVoice && !chosenVoiceLang.toLowerCase().startsWith('es');

      const nameless = devices.inputs.some((d) => !d.label);
      // The NAME is the value, not the id: it is what gets stored, because it
      // is the only thing that means the same in this page and in the floating
      // window.
      const deviceOptions = (list, fallback) => [{ value: '', label: fallback }]
        .concat(list.filter((d) => d.label).map((d) => ({ value: d.label, label: d.label })));

      return React.createElement('div', {},
        selectField(t(L.inputDevice), val.micLabel || '', deviceOptions(devices.inputs, t(L.deviceDefault)),
          (v) => set('micLabel', v)),
        selectField(t(L.outputDevice), val.outputLabel || '', deviceOptions(devices.outputs, t(L.deviceDefault)),
          (v) => set('outputLabel', v)),
        nameless
          ? React.createElement('p', { style: { fontSize: 12, color: '#8a8f98', marginTop: 4 } }, t(L.deviceNames))
          : null,
        selectField(t(L.language), val.language || 'auto', languageOptions, (v) => set('language', v)),
        textField(t(L.promptVocab), val.promptVocab || '', (v) => set('promptVocab', v)),
        textField(t(L.voicesDir), val.voicesDir || '', (v) => set('voicesDir', v)),
        selectField(t(L.voice), val.voice || '', voiceOptions, (v) => set('voice', v)),
        voiceNotSpanish
          ? React.createElement('p', { style: { fontSize: 12, color: '#e8a33d', marginTop: 4 } },
              'Aviso: una voz en inglés leerá mal las respuestas en español. / Warning: an English voice will read Spanish replies poorly.'
            )
          : null,
        React.createElement('p', { style: { fontSize: 12, color: '#8a8f98', marginTop: 6 } },
          'La clave de transcripción vive en el almacén del arnés y nunca llega aquí. / The transcription key lives in the harness credential store and never reaches this page.'
        ),
        /* EL PIE: de qué plugin es esto y dónde vive.
         *
         * Quien abre esta ficha viene de instalar algo, y lo primero que quiere
         * saber es si es lo que creía y si quedó bien puesto. Un nombre y una
         * dirección lo contestan, y de paso el proyecto se enseña. Aquí sí es un
         * enlace de verdad —esto es una página web, no la ventana— y se abre en
         * otra pestaña con `noopener`, que es lo que impide que la página de
         * destino toque a la nuestra. */
        React.createElement('p', {
          style: {
            fontSize: 11, color: '#6e757d', marginTop: 14,
            paddingTop: 10, borderTop: '1px solid rgba(139,148,158,.18)',
          },
        },
          'DSH KITT · ',
          React.createElement('a', {
            href: 'https://kittcat.com',
            target: '_blank',
            rel: 'noopener noreferrer',
            style: { color: '#9aa0a6', textDecoration: 'none', fontWeight: 600 },
          }, 'kittcat.com')
        )
      );
    }

    /* ---------------------------------------------------------------- *
     * Microphone button: record, stop, transcribe into the draft.
     * ---------------------------------------------------------------- */

    /**
     * The tool row already has controls in it, and anything we add sits right
     * beside them: a square with hardcoded greys reads as foreign no matter how
     * well it works. These values are the ones the shipped tool-row buttons
     * compute to, and the colours come from the harness theme variables so the
     * control keeps following the theme instead of freezing one palette.
     */
    /* LOS MISMOS BOTONES QUE LA VENTANA FLOTANTE.
     *
     * Eran cápsulas con el texto al lado —«Hablar», «Conversar»— y la ventana
     * son círculos de color. Dos aspectos para los mismos tres mandos es dos
     * productos: quien aprende uno tiene que volver a aprender el otro, y en
     * la fila de herramientas del arnés esas cápsulas además pesaban de más.
     *
     * Así que aquí van los mismos círculos, con los mismos colores y el mismo
     * tamaño: micrófono rojo, conversación azul, altavoz neutro. El texto pasa
     * al rótulo que sale al pasar por encima, que es donde no estorba. */
    const COLOR_MANDO = {
      mic:   { linea: 'rgba(255,107,94,.55)',  texto: '#ff6b5e', dado: '#c8372c', borde: '#ff8a80' },
      // Ámbar al silenciar: no es una avería —eso es rojo y lleva palabra— pero
      // sí es un estado del que hay que acordarse de salir.
      mute:  { linea: 'rgba(255,176,32,.55)',  texto: '#ffb020', dado: '#a86c00', borde: '#ffd27a' },
      talk:  { linea: 'rgba(90,162,255,.55)',  texto: '#5aa2ff', dado: '#1f5fc4', borde: '#86bcff' },
      speak: { linea: 'rgba(139,148,158,.35)', texto: '#cfd3d6', dado: '#3a4046', borde: '#8b949e' },
    };

    /* LOS MISMOS DIBUJOS QUE LA VENTANA FLOTANTE, trazo a trazo.
     *
     * Aquí había emojis —🎙, 💬, 🔊— y en la ventana hay dibujos de línea. El
     * emoji lo dibuja el sistema, así que cambia de forma y de color en cada
     * máquina y no se parece a nada de lo nuestro: dos superficies con los
     * mismos tres mandos se veían como dos productos distintos.
     *
     * Son las mismas rutas que `overlay/index.html`. Si se cambia una, se
     * cambian las dos: son el mismo mando en dos sitios. */
    function icono(cual) {
      const trazos = {
        mic: ['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0M12 18v3'],
        talk: [
          'M8 13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
          'M10 10h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-3l-3 3v-3h-3a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
        ],
        speak: ['M11 5 6 9H3v6h3l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7'],
        stop: ['M7 7h10v10H7z'],
        gear: ['M12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1z'],
        // El micrófono tachado: la señal universal de «no te oigo».
        mute: [
          'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z',
          'M5 11a7 7 0 0 0 14 0M12 18v3',
          'M4 4l16 16',
        ],
      };
      return React.createElement('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, (trazos[cual] || []).map((d, i) => React.createElement('path', { key: i, d })));
    }

    function toolButtonStyle(cual, encendido) {
      const c = COLOR_MANDO[cual] || COLOR_MANDO.speak;
      return {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        // Pegaditos, y el mismo hueco que en la barra flotante: son los mismos
        // mandos y tienen que verse como un solo grupo, no como tres cosas.
        // El margen es NEGATIVO porque la fila de herramientas del arnés pone
        // su propio hueco entre elemento y elemento, y ése no lo controlamos:
        // lo único que se puede hacer desde aquí es restarle. Con margen cero
        // seguían viéndose como cinco botones sueltos en vez de un grupo.
        width: 28, height: 28, padding: 0, margin: '0 -2px',
        borderRadius: '50%',
        border: `1px solid ${encendido ? c.borde : c.linea}`,
        background: encendido ? c.dado : 'rgba(139, 148, 158, 0.08)',
        color: encendido ? '#fff' : c.texto,
        fontSize: 13, lineHeight: 1, cursor: 'pointer',
        boxShadow: encendido ? `0 0 8px ${c.linea}` : 'none',
        transition: 'color .14s ease, background .14s ease, border-color .14s ease',
      };
    }

    /**
     * LA WEB, A LA IZQUIERDA DE LOS MANDOS.
     *
     * Esto se regala, así que lo justo es que se vea de dónde sale — y quien lo
     * instala agradece una señal de que quedó bien puesto. Va apagadita y se
     * enciende al pasar por encima: quien no la busca no la ve.
     *
     * Aquí sí es un enlace de verdad, porque esto es una página web. En la
     * ventana flotante no puede serlo: allí navegar está prohibido y lo abre el
     * proceso principal.
     */
    function BrandLink({ bus }) {
      /* EL VERDE, SÓLO AL PASAR POR ENCIMA.
       *
       * En el menú de la ventana la K va siempre verde y ahí está bien: se
       * abre, se mira y se cierra. Pero esta fila la tienes delante TODO EL
       * RATO mientras escribes, y un punto de color fijo en el borde del campo
       * de texto cansa la vista — se convierte en algo que apartas, no en algo
       * que miras.
       *
       * Así que en reposo va gris entera, y el color aparece cuando llevas el
       * puntero: justo cuando estás mirándola a propósito, que es cuando la
       * marca tiene algo que decir. */
      const [encima, setEncima] = useState(false);
      // Y SE APARTA EN CUANTO PASA ALGO, igual que en la barra flotante. Una
      // marca no compite por el sitio con lo que de verdad hay que leer.
      const [, force] = useState(0);
      useEffect(() => bus.subscribe(() => force((n) => n + 1)), [bus]);
      const modo = bus.getState().mode;
      if (modo && modo !== 'idle' && modo !== 'armed') return null;

      return React.createElement('a', {
        href: 'https://kittcat.com',
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'DSH KITT — kittcat.com',
        style: {
          display: 'inline-flex', alignItems: 'center',
          height: 28, margin: '0 4px 0 0', padding: 0,
          fontSize: 10, fontWeight: 600, letterSpacing: '.2px',
          color: encima ? '#ffffff' : '#97a0a9',
          textDecoration: 'none', whiteSpace: 'nowrap',
          transition: 'color .15s ease',
        },
        onMouseEnter: () => setEncima(true),
        onMouseLeave: () => setEncima(false),
        onFocus: () => setEncima(true),
        onBlur: () => setEncima(false),
      },
        React.createElement('b', {
          style: {
            fontWeight: 700, lineHeight: 1,
            color: encima ? '#5c9e6b' : 'inherit',
            transition: 'color .15s ease',
          },
        }, 'k'),
        'ittcat.com');
    }

    /**
     * SILENCIAR EL MICRÓFONO, desde la propia página.
     *
     * El mismo mando que en la barra flotante y con el mismo dibujo. La barra
     * sirve cuando estás en otra aplicación; éste, cuando ya estás mirando aquí
     * — y no obliga a buscar la ventanita para algo que se necesita rápido.
     */
    function MuteButton({ bus }) {
      const [, force] = useState(0);
      useEffect(() => bus.subscribe(() => force((n) => n + 1)), [bus]);
      const state = bus.getState();
      const title = state.muted ? t(L.micUnmute) : t(L.micMute);
      return React.createElement('button', {
        type: 'button',
        title,
        'aria-label': title,
        'aria-pressed': state.muted ? 'true' : 'false',
        onClick: () => { if (micBridge.alternarSilencio) micBridge.alternarSilencio(); },
        style: toolButtonStyle('mute', state.muted),
      }, icono('mute'));
    }

    /**
     * EL ENGRANAJE: abre la ventana flotante, que ES el panel de opciones.
     *
     * Ahí dentro están el micrófono, el altavoz, la voz, la velocidad, el
     * idioma y las teclas. No hacía falta inventar otro panel: hacía falta una
     * puerta para el que ya existe, porque hasta ahora sólo se abría sola al
     * usar la voz y no había forma de pedirla.
     *
     * El arnés no nos da manera de saltar a su página de ajustes desde aquí
     * —sólo inyectamos `slots`, `sessions` y `settingsScope`—, así que esto no
     * lleva allí. Lleva a lo que sí controlamos, que además es lo que se usa.
     */
    function OptionsButton() {
      const title = t(L.optionsTitle);
      return React.createElement('button', {
        type: 'button',
        title,
        'aria-label': title,
        onClick: () => {
          void fetch(`${location.origin}${BASE_PATH}/command`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'overlay-open' }),
          }).catch(() => { /* el fallo se ve: la ventana no aparece */ });
        },
        style: toolButtonStyle('speak', false),
      }, icono('gear'));
    }

    function MicButton({ bus, useInput, inputActions, sessionId }) {
      const recRef = useRef(null);
      const chunksRef = useRef([]);
      const rafRef = useRef(null);
      const analyserRef = useRef(null);
      const audioCtxRef = useRef(null);
      const inputRef = useRef(undefined);
      // Which recogniser to use, and in what language. Read from the host once:
      // the person may change it in Settings, so it is a ref, not a constant.
      const providerRef = useRef('browser');
      const langRef = useRef('auto');
      const engineRef = useRef('piper');
      const keyReadyRef = useRef(false);
      // The session as it is NOW. Written on every render so an asynchronous
      // reader started three seconds ago does not keep asking about the
      // conversation that was current when it began.
      const sesionRef = useRef(sessionId);
      sesionRef.current = sessionId;
      // The ONLY thing that ends a wait. There is no clock on the agent, so
      // this is how a person says «ya está bien».
      const pararPedido = useRef(false);
      const speechRef = useRef(null);
      const stopWanted = useRef(false);
      const charlaRef = useRef(null);   // el ciclo de conversacion en marcha

      const [, force] = useState(0);
      useEffect(() => bus.subscribe(() => force((x) => x + 1)), [bus]);

      useEffect(() => {
        let cancelled = false;
        void fetch(`${location.origin}${BASE_PATH}/config`)
          .then((response) => response.json())
          .then((config) => {
            if (cancelled || !config) return;
            providerRef.current = config.sttProvider || 'browser';
            langRef.current = config.language || 'auto';
            engineRef.current = config.speechEngine || 'piper';
            keyReadyRef.current = Boolean(config.apiKeyConfigured);
            fijarRitmo(config.speechRate);
            fijarIdiomaUI(config.uiLang);
            nombreDeAparato.input = config.micLabel || '';
            nombreDeAparato.output = config.outputLabel || '';
          })
          .catch(() => { /* the button still works; failures speak when used */ });
        return () => { cancelled = true; };
      }, []);

      const state = bus.getState();
      // The input machine is the single source of truth for the draft; the
      // standard session kit provides useInput (InputState.draft) for reads
      // and inputActions.setDraft for writes. We mirror it into a ref so the
      // recorder's async onstop reads the draft as it is at STOP time, not as
      // it was when recording began (the user may type while we listen).
      // `useInput` is a selector hook over the input machine (useSyncExternalStore
      // with a selector), so the selector is REQUIRED: calling it bare makes the
      // harness invoke `undefined` as the selector and the whole slot entry
      // crashes with "is not a function" — the button then never renders, and
      // nothing in the page says why. We only need the draft text.
      const draft = useInput ? useInput((snapshot) => (snapshot ? snapshot.draft : '')) : '';
      inputRef.current = { draft: draft || '' };

      /**
       * One press, one whole turn: what was said goes out, and the answer
       * comes back out loud.
       *
       * This is the OTHER mode, and it is deliberately not the same thing as
       * the open conversation. Here you decide when to speak and the exchange
       * ends with the reply; there, the microphone stays open and it goes on
       * until you stop it. Somebody driving wants both: a single question
       * mid-lap, and a conversation in the pits.
       */
      const enviarYLeer = useCallback(async () => {
        pararPedido.current = false;
        if (!inputActions || typeof inputActions.submit !== 'function') {
          bus.set({ mode: 'error', message: t(L.cannotSend) });
          return;
        }

        // What the host holds RIGHT NOW, before sending: anything that comes
        // back identical to this is the previous answer, not this one.
        let anterior = '';
        try {
          const res = await fetch(
            `${location.origin}${BASE_PATH}/last?live=1&sessionId=${encodeURIComponent(sessionId || '')}`,
            { cache: 'no-store' });
          const data = await res.json().catch(() => ({}));
          anterior = (data && data.ok) ? String(data.text || '') : '';
        } catch { /* nothing held: anything that arrives is new */ }

        // The draft was just written through the input machine. Give it the
        // tick it needs to settle before asking it to send, or it sends the
        // message as it was BEFORE the transcript landed.
        await new Promise((r) => setTimeout(r, 60));
        try { inputActions.submit(); }
        catch (error) {
          bus.set({ mode: 'error', message: `${t(L.cannotSend)} (${error?.message ?? error})` });
          return;
        }

        bus.set({ mode: 'thinking', message: null, caption: null });
        // The ear is closed while the answer is read: the browser's canceller
        // does not cover our own synthesised voice.
        bus.set({ reading: true, coverMicUntil: Date.now() + 120000 });
        try {
          const dijoAlgo = await leerSegunLlega(() => sesionRef.current, {
            motor: engineRef.current,
            idioma: langRef.current,
            anterior,
            sigueVivo: () => !pararPedido.current,
            alEmpezar: () => bus.set({ mode: 'reading', message: null, caption: null }),
          });
          // Nothing said usually means the person stopped it, and stopping
          // something is not a fault.
        } catch (error) {
          bus.set({ mode: 'error', message: String(error?.message ?? error) });
        } finally {
          if (bus.getState().mode !== 'error') {
            bus.set({ mode: 'idle', message: null, caption: null });
          }
          bus.set({ reading: false, coverMicUntil: Date.now() + REOPEN_MIC_MS });
        }
      }, [bus, inputActions, sessionId]);

      const cleanupRec = useCallback(() => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        if (recRef.current) {
          try { recRef.current.stream.getTracks().forEach((tr) => tr.stop()); } catch { /* already stopped */ }
          recRef.current = null;
        }
        if (audioCtxRef.current) { try { void audioCtxRef.current.close(); } catch { /* closed */ } audioCtxRef.current = null; }
        analyserRef.current = null;
      }, []);


      /**
       * Turn our language setting into the tag the browser recogniser wants.
       * It only accepts full BCP-47 tags, so a bare "es" is not enough and
       * "auto" means "whatever this browser is set to".
       */
      const speechLangTag = useCallback(() => {
        const chosen = String(langRef.current || 'auto').trim();
        if (!chosen || chosen === 'auto') return navigator.language || 'es-ES';
        if (chosen.includes('-')) return chosen;
        const map = { es: 'es-ES', en: 'en-US', pt: 'pt-PT', fr: 'fr-FR', it: 'it-IT', de: 'de-DE' };
        return map[chosen.toLowerCase()] || chosen;
      }, []);

      /**
       * Recognition inside the browser: no account, no key, no download. This
       * is the default so someone who just installed the plugin can talk right
       * away; Groq is there for whoever wants better accuracy.
       *
       * The audio never reaches our host in this mode — the browser vendor does
       * the recognition. That trade is stated in the settings card, not hidden.
       */
      const startBrowserRecognition = useCallback(() => {
        // Electron is the trap here. The object EXISTS inside Electron, so a
        // plain feature check passes, and then recognition dies with a network
        // error every single time — measured, not assumed. Anything embedding
        // this page in a desktop shell must therefore use a real
        // provider, and be told so rather than left pressing a dead button.
        if (/Electron/i.test(navigator.userAgent || '')) {
          bus.set({ mode: 'error', message: t(L.noSttInApp) });
          return false;
        }
        const Recogniser = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recogniser) {
          bus.set({ mode: 'error', message: t(L.noBrowserStt) });
          return false;
        }
        let recogniser;
        try {
          recogniser = new Recogniser();
        } catch {
          bus.set({ mode: 'error', message: t(L.noBrowserStt) });
          return false;
        }
        recogniser.lang = speechLangTag();
        // Keep listening until the person says stop. Left on its default the
        // recogniser closes itself after the first pause, so the button
        // "wouldn't stay pressed": you started talking, thought for a second,
        // and it had already given up.
        recogniser.continuous = true;
        recogniser.interimResults = true;

        let settled = '';
        recogniser.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) settled += result[0].transcript;
            else interim += result[0].transcript;
          }
          bus.set({ mode: 'listening', caption: (settled + interim).trim().slice(-60) });
        };
        recogniser.onerror = (event) => {
          const code = event && event.error ? String(event.error) : 'unknown';
          // Every code the browser can give gets words a person can act on.
          // "aborted" and "no-speech" are not failures: they are what a normal
          // quiet turn looks like, so they end it instead of alarming anyone.
          if (code === 'aborted' || code === 'no-speech') {
            speechRef.current = null;
            bus.set({ mode: 'idle', caption: null, message: null });
            return;
          }
          const reason =
            code === 'not-allowed' || code === 'service-not-allowed' ? t(L.micDenied)
            : code === 'audio-capture' ? t(L.noMic)
            : code === 'network' ? t(L.sttNetwork)
            : `${t(L.sttFailed)} (${code})`;
          speechRef.current = null;
          bus.set({ mode: 'error', message: reason, caption: null });
        };
        recogniser.onend = () => {
          // Browsers still close the recogniser on their own after a long
          // silence, whatever `continuous` says. If the person has not asked
          // to stop, open it again and carry on with what is already settled —
          // otherwise a pause to think would end the turn for them.
          if (speechRef.current === recogniser && !stopWanted.current) {
            try { recogniser.start(); return; } catch { /* fall through and settle */ }
          }
          speechRef.current = null;

          // A failed turn reports twice: the error first, then "finished". The
          // second must not wipe the first — that is how a plugin ends up
          // failing in total silence, which is the one thing it must never do.
          if (bus.getState().mode === 'error') return;

          const text = settled.trim();
          if (!text) {
            bus.set({ mode: 'idle', caption: null, message: null });
            return;
          }
          // Same rule as the other path: append, never overwrite what the
          // person already typed, and never send on their behalf.
          const live = inputRef.current;
          const current = live && typeof live.draft === 'string' ? String(live.draft || '').trim() : '';
          if (inputActions) inputActions.setDraft(current ? `${current} ${text}` : text);
          bus.set({ mode: 'idle', caption: null, message: null });
          // NO SE ENVÍA SOLO. El texto se queda en la caja y lo manda quien
          // habla, con su Enter de siempre. Ver la nota del otro camino.
        };

        try {
          recogniser.start();
        } catch {
          bus.set({ mode: 'error', message: t(L.sttFailed) });
          return false;
        }
        stopWanted.current = false;
        speechRef.current = recogniser;
        bus.set({ mode: 'listening', message: null, caption: null, level: 0 });
        return true;
      }, [bus, inputActions, speechLangTag]);

      const startRecording = useCallback(async () => {
        // Rule 3: while reading, the mic stays covered. Stop the reading and
        // wait half a second before opening the ear again, so the app does not
        // hear its own voice and loop. Always read the live bus state here,
        // never a render-time closure: the covered window is set by the
        // speaker button asynchronously.
        let live = bus.getState();
        if (live.reading) {
          bus.set({ coverMicUntil: Date.now() + REOPEN_MIC_MS, reading: false });
          await new Promise((resolve) => setTimeout(resolve, REOPEN_MIC_MS));
          live = bus.getState();
        }
        if (Date.now() < live.coverMicUntil) {
          bus.set({ mode: 'error', message: t(L.micCovered) });
          return;
        }

        // The browser recogniser needs no host round-trip and no key — but it
        // does not work inside a desktop shell. When it cannot be used and a
        // real provider is configured, switch instead of refusing: the person
        // asked to talk, not to read about providers.
        const inDesktopShell = /Electron/i.test(navigator.userAgent || '');
        if (providerRef.current === 'browser') {
          if (!inDesktopShell) { startBrowserRecognition(); return; }
          if (!keyReadyRef.current) { startBrowserRecognition(); return; }
          bus.set({ mode: 'idle', message: t(L.switchedToKeyed) });
        }
        // Everything below sends audio to the host. Saying up front that the
        // key is missing beats recording a whole sentence and losing it.
        if (!keyReadyRef.current) {
          bus.set({ mode: 'error', message: t(L.noKey) });
          return;
        }

        let stream;
        try {
          const chosenInput = await idDeAparato('input');
          // `exact` on purpose: silently recording from a different microphone
          // than the one that was picked is worse than failing and saying so.
          // SE PIDE LA CANCELACION DE ECO, SIEMPRE.
          // No se pedia. Sin decirlo, el navegador decide por su cuenta, y
          // decide distinto segun como se le pida el aparato. Es la diferencia
          // entre poder hablar con los altavoces puestos y no poder.
          const filtros = {
            echoCancellation: true,   // no oirse a uno mismo por el altavoz
            noiseSuppression: true,   // el ventilador, el teclado, la calle
            autoGainControl: true,    // hablar bajito y que se entienda igual
          };
          stream = await navigator.mediaDevices.getUserMedia({
            audio: chosenInput
              ? { deviceId: { exact: chosenInput }, ...filtros }
              : filtros,
          });
        } catch {
          bus.set({ mode: 'error', message: t(L.noMic) });
          return;
        }

        // Rule 2: MediaRecorder records, AnalyserNode meters.
        let mime = 'audio/webm';
        const recorder = new MediaRecorder(stream);
        try {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
        } catch { /* keep default */ }
        if (recorder.mimeType) mime = recorder.mimeType;

        chunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };

        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          const ac = new Ctx();
          const source = ac.createMediaStreamSource(stream);
          const analyser = ac.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          audioCtxRef.current = ac;
          analyserRef.current = analyser;
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            // Escalado aquí, como en la conversación: los dos caminos tienen
            // que entregar el mismo 0..1 o la barra se movería distinto según
            // qué botón hayas pulsado, que es de las cosas que hacen dudar de
            // si algo funciona.
            const level = Math.min(1, (sum / data.length / 255) * 3);
            bus.set({ level });
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        } catch {
          /* metering is cosmetic; recording still works without it */
        }

        recorder.onstop = async () => {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          const blob = new Blob(chunksRef.current, { type: mime });
          chunksRef.current = [];
          if (blob.size === 0) {
            bus.set({ mode: 'error', message: t(L.noAudio) });
            cleanupRec();
            return;
          }
          bus.set({ mode: 'transcribing', caption: null, message: null });
          try {
            // Rule 1: the webm goes to the host raw; the page never decodes it.
            const res = await fetch(`${location.origin}${BASE_PATH}/transcribe?mime=${encodeURIComponent(mime)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream' },
              body: blob,
            });
            const data = await res.json().catch(() => ({}));
            if (data && data.ok && typeof data.text === 'string' && data.text.trim()) {
              const text = data.text.trim();
              if (inputActions) {
                // Keep whatever the user already typed: append the transcript
                // with a separating space, never overwrite their draft. The
                // draft text comes from the input machine state (InputState
                // is the read face; InputActions is the write face); read it
                // from the ref so it is the stop-time draft.
                const liveInput = inputRef.current;
                const current = liveInput && typeof liveInput.draft === 'string'
                  ? String(liveInput.draft || '').trim()
                  : '';
                inputActions.setDraft(current ? `${current} ${text}` : text);
              }
              bus.set({ mode: 'idle', message: null, caption: null, level: 0 });
              /* NO SE ENVÍA SOLO, Y ESTO ES DELIBERADO.
               *
               * Enviaba en cuanto terminaba de transcribir, y eso convierte
               * pulsar el micrófono en una apuesta: Whisper se come una palabra,
               * confunde un término, o coge un ruido de fondo — y eso ya se ha
               * ido al agente en tu nombre, sin que lo hayas leído.
               *
               * El texto se queda en la caja para que se pueda corregir, y lo
               * manda quien habla con su Enter de siempre. Es lo que el README
               * prometía desde el primer día («tú decides cuándo enviarlo») y lo
               * que el código no hacía.
               *
               * La conversación manos libres SÍ envía sola, y ahí está bien: ese
               * modo existe justo para no tocar nada. Son dos modos distintos y
               * ésta es la diferencia entre ellos. */
            } else {
              bus.set({ mode: 'error', message: (data && data.reason) ? data.reason : 'Transcription failed.' });
            }
          } catch (err) {
            bus.set({ mode: 'error', message: String((err && err.message) || err || 'Transcription failed.') });
          } finally {
            cleanupRec();
          }
        };

        recRef.current = recorder;
        recorder.start();
        bus.set({ mode: 'listening', message: null, caption: null, level: 0 });
      }, [bus, inputActions, cleanupRec]);

      const stopRecording = useCallback(() => {
        const recogniser = speechRef.current;
        if (recogniser) {
          // Say so before stopping, or onend reopens it and the button never
          // lets go.
          stopWanted.current = true;
          try { recogniser.stop(); } catch { /* onend still settles the turn */ }
          return;
        }
        const recorder = recRef.current;
        if (!recorder || recorder.state === 'inactive') return;
        try { recorder.stop(); } catch { /* onstop handles the failure path */ }
      }, []);


      /* ================================================================== *
       * HANDS-FREE CONVERSATION
       *
       * Dictation is: press, talk, press, then press again to hear the reply.
       * That is not talking to somebody — it is operating a machine. A
       * conversation is: you say something, it notices you have finished, it
       * sends, it answers out loud, and it goes back to listening.
       *
       * The turn ends on MEASURED silence from the microphone, never on a
       * timer: pausing to think must not end your sentence for you.
       *
       * And while it speaks, the ear closes. The browser's echo canceller does
       * not cover the voice coming out of the speakers: left open, it hears
       * itself, believes it was spoken to, and loops forever. Measured in this
       * house, not assumed.
       * ================================================================== */

      /**
       * Algo ha ido mal, pero la conversación SIGUE.
       *
       * Antes cualquier tropiezo la cerraba, y desde fuera eso se ve así: el
       * sistema se apaga solo, y el botón que debería cortarlo lo que hace es
       * arrancar otro. Un fallo de una frase no es motivo para colgar: se dice
       * lo que ha pasado y se vuelve a escuchar. Apagar es cosa de quien lo usa.
       */
      const avisarSinColgar = useCallback((motivo) => {
        bus.set({ mode: 'error', message: motivo, caption: null, level: 0 });
      }, [bus]);

      const pararCharla = useCallback((motivo) => {
        const c = charlaRef.current;
        charlaRef.current = null;
        // Sólo si había algo abierto: un tono de colgar cuando no había llamada
        // es un sonido que no significa nada.
        if (c) { tonoColgar(); try { c.cerrar(); } catch { /* already closed */ } }
        bus.set({
          conversation: false,
          mode: motivo ? 'error' : 'idle',
          message: motivo || null,
          caption: null,
          level: 0,
        });
      }, [bus]);

      /** Wait for the agent to finish answering. Returns the text, or null if
       *  the loop was closed on the way. */
      const arrancarCharla = useCallback(async () => {
        if (charlaRef.current) return;
        if (providerRef.current === 'browser' && /Electron/i.test(navigator.userAgent || '')) {
          bus.set({ mode: 'error', message: t(L.noSttInApp) });
          return;
        }
        if (!keyReadyRef.current) { bus.set({ mode: 'error', message: t(L.talkNeedsKey) }); return; }

        if (!(await asegurarDetector(bus))) return;

        let lib;
        try { lib = await cargarDetector(); }
        catch (error) { bus.set({ mode: 'error', message: `${t(L.vadFailed)}: ${error.message}` }); return; }

        let cerrado = false;
        let leyendo = false;      // the ear is covered while the reply is read
        let ecoEnCurso = false;   // a turn that began during the reading
        // EL RELEVO. Cada turno coge un numero al empezar; el que deja de ser
        // el ultimo pierde el derecho a escribir el borrador, a enviar y a
        // leer en alto. Sin esto, hablar mientras el agente piensa lanzaria
        // dos turnos a la vez y se pisarian.
        let turnoActual = 0;

        /* CORTARLE HABLANDO, MIENTRAS LEE.
         *
         * Estas tres cosas son todo lo que hace falta: cuando empezo a leer,
         * cuanto eco entra por el microfono en esta maquina, y cuanto rato
         * lleva sonando algo que supera ese eco.
         *
         * El suelo se vuelve a medir en CADA lectura, no una vez al arrancar:
         * el volumen cambia, los auriculares se ponen y se quitan, y una
         * medida vieja es peor que ninguna. */
        // La decision de «esto es una voz y no mi propio eco» vive en
        // lib/corte.js, que es donde se puede probar sin un microfono y una
        // habitacion. Aqui solo se guarda el estado de la lectura en curso.
        let corte = null;
        let cortado = false;      // alguien pidio la palabra: no se sigue leyendo

        /* ── CUANDO ALGUIEN ESTA PIDIENDO LA PALABRA ──────────────────────
         *
         * Esto vive AQUI DENTRO y no en un modulo aparte por una razon dura:
         * este fichero se le sirve al navegador como uno solo, sin
         * empaquetador, y el cargador del arnes lo carga como un bundle. Un
         * «import» de un fichero hermano hace que el bundle se cargue sin
         * registrarse y el arnes se queda en «Failed to load plugins» — con el
         * plugin entero fuera, no solo esta funcion. Medido a base de romperlo.
         *
         * La misma logica esta tambien en lib/corte.js, que es la copia que se
         * puede probar sin un navegador. Duplicar es malo; duplicar con una
         * prueba que comprueba que las dos dicen lo mismo es lo unico que
         * funciona aqui. Si tocas una, toca la otra: la prueba te lo dira.
         *
         * NO SE ADIVINA UN UMBRAL, SE MIDE. Durante el primer medio segundo de
         * cada lectura lo que entra por el microfono ES el eco, por definicion,
         * porque todavia no ha hablado nadie. Ese es el suelo de esta maquina
         * en esta habitacion. Para contar como voz hay que pasarlo con holgura
         * y sostenerlo. */
        const CALIBRAR_MS = 550;      // cuanto se escucha antes de decidir nada
        const HOLGURA = 3.2;          // cuanto hay que pasar el suelo
        const MINIMO_ABSOLUTO = 0.02; // con cascos el suelo es casi cero
        const SOSTENER_MS = 320;      // una tos o un portazo duran menos

        const nuevoCorte = (ahora) => ({ desde: ahora, suelo: 0, vozDesde: 0 });

        function mirarCorte(estado, energia, ahora) {
          if (ahora - estado.desde < CALIBRAR_MS) {
            if (energia > estado.suelo) estado.suelo = energia;
            return 'calibrando';
          }
          const liston = Math.max(estado.suelo * HOLGURA, MINIMO_ABSOLUTO);
          if (energia <= liston) { estado.vozDesde = 0; return 'nada'; }
          if (!estado.vozDesde) { estado.vozDesde = ahora; return 'nada'; }
          if (ahora - estado.vozDesde < SOSTENER_MS) return 'nada';
          estado.vozDesde = 0;
          return 'cortar';
        }
        let vad = null;

        const vivo = () => !cerrado;
        charlaRef.current = {
          cerrar() {
            cerrado = true;
            if (vad) { try { void vad.destroy(); } catch { /* going anyway */ } }
            vad = null;
          },
          /* Parar y arrancar el oído sin cerrar la conversación. Es lo que usa
           * el silencio: silenciar deja la llamada en espera, no la cuelga. */
          silenciar() { if (vad) vad.pause(); },
          escuchar() { if (vad) vad.start(); },
        };

        /** One finished turn: transcribe, show it, send it, wait, read it. */
        const turno = async (audio) => {
          // Este turno es el nuevo, asi que a partir de aqui manda el.
          const miNumero = ++turnoActual;
          const vigente = () => miNumero === turnoActual && !cerrado;

          // Y si habia algo sonando, se calla: hablar mientras te leen es
          // pedir la palabra, y quedarse los dos hablando a la vez no ayuda a
          // nadie.
          callar();
          leyendo = false;
          ecoEnCurso = false;

          bus.set({ mode: 'transcribing', level: 0, caption: null });

          let texto = '';
          try {
            const wav = lib.utils.encodeWAV(audio, 1, 16000, 1, 16);
            const res = await fetch(
              `${location.origin}${BASE_PATH}/transcribe?mime=${encodeURIComponent('audio/wav')}`,
              { method: 'POST', body: wav });
            const data = await res.json().catch(() => ({}));
            if (!data.ok) { avisarSinColgar(data.reason || t(L.sttFailed)); return; }
            texto = String(data.text || '').trim();
          } catch (error) {
            avisarSinColgar(`${t(L.sttFailed)}: ${error?.message ?? error}`);
            return;
          }
          // Si mientras se transcribia entro un turno nuevo, este ya no manda:
          // se calla y deja el sitio. Escribir el borrador aqui seria pisar lo
          // que la persona acaba de decir.
          if (!vigente()) return;
          if (!texto) { bus.set({ mode: 'listening' }); return; }

          if (inputActions) {
            try { inputActions.setDraft(texto); } catch { /* the send will say */ }
          }

          // What the host holds RIGHT NOW, before sending. Whatever comes back
          // identical to this is the previous answer, not this one.
          let anterior = '';
          try {
            const res = await fetch(
              `${location.origin}${BASE_PATH}/last?live=1&sessionId=${encodeURIComponent(sessionId || '')}`,
              { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            anterior = (data && data.ok) ? String(data.text || '') : '';
          } catch { /* nothing held: anything that arrives is new */ }

          if (!inputActions || typeof inputActions.submit !== 'function') {
            avisarSinColgar(t(L.cannotSend));
            return;
          }
          try { inputActions.submit(); }
          catch (error) { avisarSinColgar(`${t(L.cannotSend)} (${error?.message ?? error})`); return; }

          bus.set({ mode: 'thinking', caption: null });

          // THE ECHO CURE. The browser's canceller does not cover our own
          // speech: with the ear open the detector hears the reply, decides it
          // was spoken to, and the thing talks to itself forever. So the
          // detector is PAUSED before a word is said, and anything that still
          // slipped in while we spoke is thrown away whole.
          //
          // PERO NO SE CIERRA AL ENVIAR, SINO AL EMPEZAR A SONAR.
          //
          // Estaba puesto aqui, y aqui todavia no ha sonado ni una palabra: el
          // agente esta pensando. Se cerraba el oido durante todo ese rato
          // —en una pregunta con herramientas, varios segundos— sin que
          // hubiera ningun eco del que defenderse. Encontrado usandolo: le
          // hablas mientras piensa y se queda sordo.
          //
          // Ahora se cierra en «alEmpezar», que es la primera palabra dicha en
          // voz alta. Mientras piensa, el oido esta abierto.

          let dijoAlgo = false;
          try {
            dijoAlgo = await leerSegunLlega(() => sesionRef.current, {
              motor: engineRef.current,
              idioma: langRef.current,
              anterior,
              // Se deja de leer en cuanto entra un turno nuevo. Esto es lo que
              // hace que cortarle funcione de verdad: no basta con oir, hay
              // que callarse al oir.
              // Y para de leer si alguien ha pedido la palabra. Sin esto,
              // callar() silencia la frase en curso y el bucle arranca la
              // siguiente medio segundo despues: callarse una frase y seguir
              // con la otra es no callarse.
              sigueVivo: () => vigente() && !cortado,
              alEmpezar: () => {
                // AHORA SI: esta sonando, y esto es lo unico que el detector
                // no debe oir. Se cierra el oido aqui y no un segundo antes.
                leyendo = true;
                // EL OIDO SE QUEDA ABIERTO, pero sordo a todo lo que no pase
                // el liston: asi se puede cortar hablando. El detector NO se
                // pausa; lo que filtra es el suelo de eco medido abajo.
                corte = nuevoCorte(Date.now());
                cortado = false;
                bus.set({ mode: 'reading', message: null, caption: null, reading: true, coverMicUntil: Date.now() + 120000 });
              },
            });
          } catch (error) {
            bus.set({ mode: 'error', message: String(error?.message ?? error) });
          }

          // The air takes a moment to go quiet after the speaker stops.
          await new Promise((r) => setTimeout(r, REOPEN_MIC_MS));
          leyendo = false;
          ecoEnCurso = false;
          bus.set({ reading: false });
          if (cerrado) return;
          // Nothing said is not a failure either: it is somebody pressing
          // stop, or an answer that was only a tool call. The ear reopens.
          // Si el oído no vuelve a abrirse, la conversación está encendida y
          // sorda: el peor sitio para callarse. El comentario de antes decía
          // que la línea de estado lo diría, y no lo decía nadie.
          let oyendo = true;
          if (vad) {
            try { vad.start(); }
            catch (error) {
              oyendo = false;
              bus.set({ mode: 'error', message: `${t(L.micLost)} (${error?.message ?? error})` });
            }
          }
          if (oyendo) bus.set({ mode: 'armed', message: null, caption: null });
        };

        try {
          const assets = `${location.origin}${BASE_PATH}/vad/file/`;
          vad = await lib.MicVAD.new({
            ...VAD_SETTINGS,
            // El detector abre SU PROPIO microfono, asi que los filtros que se
            // piden mas arriba no le llegan: hay que decirselo tambien a el.
            additionalAudioConstraints: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            baseAssetPath: assets,
            onnxWASMBasePath: assets,
            ortConfig: (ort) => {
              // Without cross-origin isolation the threaded wasm cannot share
              // memory, and forcing one thread is the only way it starts at
              // all. Measured, not guessed.
              try { ort.env.wasm.numThreads = 1; } catch { /* older build */ }
              try { ort.env.logLevel = 'error'; } catch { /* older build */ }
            },
            // «Escuchando» quiere decir QUE HAY UNA VOZ AHORA MISMO, no que el
            // micrófono esté abierto. Estaba puesto de la otra forma y en
            // pantalla ponía «Escuchando» sin parar, que es exactamente lo que
            // no quieres leer en un puesto con el motor sonando: parece que te
            // está grabando entero. Entre turno y turno esto está en REPOSO.
            onSpeechStart: () => {
              if (leyendo) { ecoEnCurso = true; return; }
              bus.set({ mode: 'listening', caption: null, level: 0 });
            },
            /**
             * LO FUERTE QUE ESTÁS HABLANDO, DE VERDAD.
             *
             * Aquí había un 0,5 fijo. O sea que el halo de la barra y los
             * segmentos decían crecer con la voz y no crecían con nada: se
             * quedaban clavados a media altura mientras hablabas. Y el README
             * prometía justo lo contrario, «nunca con una animación inventada».
             *
             * El detector ya nos entrega cada trozo de audio para decidir si
             * hay voz, así que el volumen sale de ahí: ni un micrófono más
             * abierto, ni un analizador aparte. Se mide la energía del trozo
             * —la media de cuánto se separa de cero— que es lo que el oído
             * entiende por «fuerte».
             */
            onFrameProcessed: (probs, frame) => {
              if (cerrado || !frame || !frame.length) return;
              let suma = 0;
              for (let i = 0; i < frame.length; i++) suma += frame[i] * frame[i];
              const energia = Math.sqrt(suma / frame.length);

              /* MIENTRAS LEE: se mide el eco y se decide si alguien esta
                 pidiendo la palabra. Ni se pinta el nivel ni se hace nada mas:
                 la barra en reposo mientras habla el agente es lo correcto. */
              if (leyendo) {
                if (!corte) return;
                if (mirarCorte(corte, energia, Date.now()) === 'cortar') {
                  // ALGUIEN ESTÁ HABLANDO POR ENCIMA. Se calla y se le deja el
                  // turno: a partir de aquí el detector vuelve a ser un
                  // detector normal, y su onSpeechEnd traerá lo que diga.
                  cortado = true;
                  leyendo = false;
                  ecoEnCurso = false;
                  callar();
                  // Y SE TIRA LO GRABADO. El detector lleva grabando desde que
                  // oyó el eco; si se le deja ese trozo, lo que se manda a
                  // transcribir empieza con la voz del propio plugin. Se para y
                  // se arranca, que vacía lo que llevaba dentro. Cuesta el
                  // arranque de la primera palabra, y es un precio mucho menor
                  // que mandar a transcribir la propia respuesta.
                  if (vad) {
                    try { vad.pause(); vad.start(); } catch { /* sigue como pueda */ }
                  }
                  bus.set({ reading: false, mode: 'listening', caption: null, level: 0 });
                }
                return;
              }

              if (ecoEnCurso) return;
              // Sólo mientras hay voz. Fuera de turno la barra está en reposo y
              // pintar el ruido de la sala ahí sería decir que te escucha.
              if (bus.getState().mode !== 'listening') return;
              // La escala se ajusta aquí, no en la ventana: el que mide es
              // quien sabe en qué unidades mide.
              //
              // Y va SOBRADA de ganancia a propósito. Una voz de conversación
              // normal —sin gritar, a medio metro— se mueve por la parte muy
              // baja de la escala, así que con la ganancia justa la barra
              // apenas se despegaba del primer segmento y parecía rota. Se
              // prefiere que llegue al tope al levantar la voz que no que no
              // llegue nunca: esto es un indicador para mirar de reojo, no un
              // instrumento de medida.
              bus.set({ level: Math.min(1, energia * 14) });
            },
            onVADMisfire: () => {
              ecoEnCurso = false;
              // Ha sido un ruido, no una voz: vuelve al reposo sin más.
              bus.set({ level: 0, mode: leyendo ? bus.getState().mode : 'armed' });
            },
            onSpeechEnd: (audio) => {
              const eraEco = ecoEnCurso || leyendo;
              ecoEnCurso = false;
              if (eraEco || cerrado) return;   // born while we spoke: our own voice
              return turno(audio);
            },
          });
        } catch (error) {
          charlaRef.current = null;
          bus.set({ mode: 'error', message: `${t(L.vadFailed)}: ${error?.message ?? error}` });
          return;
        }

        try { vad.start(); }
        catch (error) { pararCharla(`${t(L.micDenied)} (${error?.message ?? error})`); return; }
        tonoAbrir();
        bus.set({ conversation: true, mode: 'armed', message: null, caption: null });
      }, [bus, inputActions, sessionId, pararCharla, avisarSinColgar]);

      const onClick = () => {
        const s = bus.getState();
        // Silenciado es silenciado: ni siquiera a propósito. Si al pulsar el
        // micrófono se quitara el silencio solo, el silencio no serviría de
        // nada — sería un botón que se desactiva justo cuando lo necesitas.
        if (s.muted) return;
        if (s.mode === 'listening') stopRecording();
        else void startRecording();
      };

      /* SILENCIAR EL MICRÓFONO.
       *
       * Vive aquí porque aquí está el detector: silenciar de verdad es PARARLO,
       * no ignorar lo que diga. Un detector que sigue corriendo con el oído
       * abierto mientras la pantalla dice «silenciado» es exactamente la clase
       * de mentira que hace que nadie se fíe de un botón de silencio.
       *
       * Al quitarlo se vuelve a arrancar sólo si la conversación seguía en
       * marcha: silenciar no cuelga la llamada, la deja en espera.
       */
      const alternarSilencio = useCallback(() => {
        const s = bus.getState();
        const ahoraSilenciado = !s.muted;
        const charla = charlaRef.current;
        if (charla) {
          try {
            if (ahoraSilenciado) charla.silenciar();
            else charla.escuchar();
          } catch { /* el estado manda igual; el detector se recupera al reabrir */ }
        }
        // Un turno de pulsar y hablar que estuviera grabando se corta: seguir
        // grabando con el micrófono «silenciado» sería lo contrario de lo que
        // dice el botón.
        if (ahoraSilenciado && s.mode === 'listening') {
          try { stopRecording(); } catch { /* ya estaba parado */ }
        }
        bus.set({
          muted: ahoraSilenciado,
          mode: ahoraSilenciado ? 'armed' : bus.getState().mode,
          message: null,
          caption: null,
          level: 0,
        });
      }, [bus, stopRecording]);

      useEffect(() => bus.onOrder('mic-mute', alternarSilencio));
      micBridge.alternarSilencio = alternarSilencio;

      // The same action a wheel button triggers from outside the browser.
      // Silence also calls off a wait: pressing «callar» while the agent is
      // still working has to end it, or the only way out is closing the page.
      useEffect(() => bus.onOrder('stop-speaking', () => { pararPedido.current = true; }));
      useEffect(() => bus.onOrder('record-toggle', onClick));

      const busy = state.mode === 'listening' || state.mode === 'transcribing';
      const title = busy ? t(L.micStop) : t(L.micRecord);
      // Held for the conversation button registered below.
      micBridge.arrancarCharla = arrancarCharla;
      micBridge.pararCharla = pararCharla;

      return React.createElement('button', {
        type: 'button',
        title,
        'aria-label': title,
        onClick,
        style: toolButtonStyle('mic', state.mode === 'listening'),
      }, icono(busy ? 'stop' : 'mic'));
    }

    /* ---------------------------------------------------------------- *
     * Speaker button: read the last assistant reply, stop when pressed again.
     * ---------------------------------------------------------------- */
    function SpeakButton({ bus, sessionId }) {
      // Which engine is available, and in what language to read. Asked once and
      // kept in refs, because the person can change both in Settings.
      const engineRef = useRef('piper');
      const langRef = useRef('auto');
      const [, force] = useState(0);

      useEffect(() => {
        let cancelled = false;
        void fetch(`${location.origin}${BASE_PATH}/config`)
          .then((r) => r.json())
          .then((config) => {
            if (cancelled || !config) return;
            engineRef.current = config.speechEngine || 'piper';
            langRef.current = config.language || 'auto';
            fijarRitmo(config.speechRate);
            fijarIdiomaUI(config.uiLang);
            nombreDeAparato.output = config.outputLabel || '';
          })
          .catch(() => { /* assume Piper; the failure will say otherwise */ });
        return () => { cancelled = true; };
      }, []);

      useEffect(() => bus.subscribe(() => force((x) => x + 1)), [bus]);
      const state = bus.getState();

      // Rule 3 enforcement from the speaker side: the microphone button can
      // request silence (reading -> false) while a reply is playing. If that
      // happens, silence it here too; otherwise the app keeps talking while
      // the mic opens, hears itself, and loops.
      useEffect(() => {
        if (!state.reading) callar();
      }, [state.reading]);

      const stopReading = useCallback(() => {
        // Whatever is speaking, of the two, stops here. Forgetting one of them
        // is how a stop button ends up lying.
        callar();
        // The message goes with it. A line that says «reading with the built-in
        // voice» while nothing is being read is a stale fact on screen, and a
        // stale fact is worse than no fact.
        bus.set({
          mode: state.mode === 'reading' ? 'idle' : state.mode,
          message: state.mode === 'reading' ? null : state.message,
          reading: false,
          coverMicUntil: Date.now() + REOPEN_MIC_MS,
        });
      }, [bus, state.mode, state.message]);

      const startReading = useCallback(async () => {
        // Cover the mic while the reply plays: the browser's echo cancellation
        // does not cover our own synthesised voice (rule 3).
        bus.set({ reading: true, coverMicUntil: Date.now() + 30000 });
        bus.set({ mode: 'reading', message: null, caption: null });
        try {
          const last = await fetch(`${location.origin}${BASE_PATH}/last?sessionId=${encodeURIComponent(sessionId || '')}`);
          const lastData = await last.json().catch(() => ({}));
          if (!lastData || !lastData.ok || !lastData.text) {
            // No hay nada que leer todavía: eso no es rojo. Rojo es que algo se
            // ha roto, y si el rojo sale también por esto deja de querer decir
            // nada. Las palabras las pone esta página, en su idioma; la frase
            // que manda el servidor está en inglés y no es para enseñar.
            const seRompio = lastData && lastData.code !== 'no-reply';
            bus.set({
              mode: seRompio ? 'error' : 'idle',
              message: seRompio ? (lastData.reason || t(L.noReply)) : t(L.noReply),
              reading: false,
            });
            return;
          }

          const como = await hablarTexto(lastData.text, {
            motor: engineRef.current,
            idioma: langRef.current,
          });
          // Only tidy up if nobody stopped us: stopReading already left the
          // right state behind, and overwriting it would undo the stop.
          if (bus.getState().reading) {
            bus.set({
              mode: 'idle',
              // Say which voice it was ONLY when it was not the good one.
              message: como === 'sistema' ? t(L.systemVoiceInstead) : null,
              reading: false,
              coverMicUntil: Date.now() + REOPEN_MIC_MS,
            });
          }
        } catch (err) {
          bus.set({ mode: 'error', message: String((err && err.message) || err || 'Reading failed.'), reading: false });
        }
      }, [bus, sessionId]);

      const onClick = () => {
        if (state.reading) stopReading();
        else void startReading();
      };

      // The same two actions, reachable from outside the browser: one order to
      // hear the reply, one to shut it up. Silence is separate on purpose — you
      // want to stop a long answer without also starting a new one.
      // The condition is read from the bus AT THE MOMENT THE ORDER ARRIVES, not
      // from the snapshot this render closed over. An order comes from outside
      // the browser, so it can land in a page that has not re-rendered since
      // the last reply — and a stale `reading: true` would swallow every wheel
      // button press from then on, silently. Measured: that is exactly what it
      // did.
      useEffect(() => bus.onOrder('speak-last', () => {
        if (!bus.getState().reading) void startReading();
      }));
      useEffect(() => bus.onOrder('stop-speaking', () => {
        if (bus.getState().reading) stopReading();
      }));

      const title = state.reading ? t(L.speakStop) : t(L.speakTitle);
      return React.createElement('button', {
        type: 'button',
        title,
        'aria-label': title,
        onClick,
        style: toolButtonStyle('speak', state.reading),
      }, icono(state.reading ? 'stop' : 'speak'));
    }

    /* ---------------------------------------------------------------- *
     * Status line under the composer: always visible.
     * ---------------------------------------------------------------- */
    function StatusBar({ bus }) {
      const [, force] = useState(0);
      const [staleReason, setStaleReason] = useState('');
      useEffect(() => bus.subscribe(() => force((x) => x + 1)), [bus]);

      // Ask the host once whether it is serving an older copy of this plugin.
      // Installing an update rewrites the files but not the running process,
      // and relaunching the harness does not always stop the previous server —
      // so the page reconnects to the old one and the update seems to have done
      // nothing. Saying it plainly here saves the hour it otherwise costs.
      useEffect(() => {
        let cancelled = false;
        void fetch(`${location.origin}${BASE_PATH}/config`)
          .then((response) => response.json())
          .then((config) => {
            if (!cancelled && config && config.stale) setStaleReason(config.staleReason || '');
          })
          .catch(() => { /* a config that will not load is reported elsewhere */ });
        return () => { cancelled = true; };
      }, []);

      const state = bus.getState();

      let text = '';
      if (state.mode === 'listening') text = t(L.listening) + (state.caption ? ` ${state.caption}` : '');
      else if (state.mode === 'transcribing') text = t(L.transcribing);
      else if (state.mode === 'thinking') text = t(L.thinking);
      else if (state.mode === 'reading') text = t(L.reading) + (state.caption ? ` ${state.caption}` : '');
      else if (state.mode === 'error') text = state.message || 'Error';

      if (staleReason) {
        return React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
            color: '#f5c76e', padding: '2px 8px', minHeight: 18,
          },
          title: staleReason,
        },
          React.createElement('span', {},
            'DSH KITT se ha actualizado: reinicia el arnés del todo (cerrarlo y volver a abrirlo no siempre mata el servidor anterior). '
            + '· DSH KITT was updated: stop the harness completely and start it again.')
        );
      }

      if (!text && state.mode === 'idle') return null;

      return React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: state.mode === 'error' ? '#f2b8b5' : '#9aa0a6',
          padding: '2px 8px', minHeight: 18,
        },
      },
        state.mode === 'listening'
          ? React.createElement('span', { style: { width: 6, height: 6, borderRadius: 3, background: '#b3261e', flexShrink: 0 } })
          : null,
        React.createElement('span', {}, text)
      );
    }

    /**
     * The conversation button.
     *
     * Deliberately separate from the microphone. Dictation puts words in the
     * box and waits for you; a conversation SENDS on its own, and something
     * that sends on its own to an agent with real tools is not a thing to
     * start by accident. One is a pen, the other is a phone call.
     */
    function TalkButton({ bus }) {
      const [, force] = useState(0);
      useEffect(() => bus.subscribe(() => force((x) => x + 1)), [bus]);
      const state = bus.getState();
      const enCharla = Boolean(state.conversation);

      const onClick = () => {
        if (enCharla) micBridge.pararCharla && micBridge.pararCharla();
        else if (micBridge.arrancarCharla) void micBridge.arrancarCharla();
      };

      useEffect(() => bus.onOrder('talk-toggle', onClick));

      const title = enCharla ? t(L.talkStop) : t(L.talkStart);
      return React.createElement('button', {
        type: 'button',
        title,
        'aria-label': title,
        onClick,
        style: toolButtonStyle('talk', enCharla),
      }, icono(enCharla ? 'stop' : 'talk'));
    }

    /* ---------------------------------------------------------------- *
     * apply: register the slots.
     * ---------------------------------------------------------------- */
    function apply(ctx) {
      const bus = createBus();
      if (typeof ctx.effect === 'function') ctx.effect(() => () => bus.dispose());

      // Orden 79: por delante de los tres mandos, que van del 80 al 82.
      ctx.slots.inject(
        'conversation.input.right',
        () => ctx.slots.register(
          { name: 'conversation.input.right', id: 'dsh-kitt-voice-brand', order: 79, inject: () => ({ bus }) },
          BrandLink
        )
      );

      ctx.slots.inject(
        'conversation.input.right',
        () => ctx.slots.register(
          { name: 'conversation.input.right', id: 'dsh-kitt-voice-mic', order: 80, inject: () => ({ bus }) },
          MicButton
        )
      );

      ctx.slots.inject(
        'conversation.input.right',
        () => ctx.slots.register(
          { name: 'conversation.input.right', id: 'dsh-kitt-voice-mute', order: 81.5, inject: () => ({ bus }) },
          MuteButton
        )
      );

      ctx.slots.inject(
        'conversation.input.right',
        () => ctx.slots.register(
          { name: 'conversation.input.right', id: 'dsh-kitt-voice-talk', order: 81, inject: () => ({ bus }) },
          TalkButton
        )
      );

      ctx.slots.inject(
        'conversation.input.right',
        () => ctx.slots.register(
          { name: 'conversation.input.right', id: 'dsh-kitt-voice-speak', order: 82, inject: () => ({ bus }) },
          SpeakButton
        )
      );

      // El último: las opciones, que abren la ventana flotante.
      ctx.slots.inject(
        'conversation.input.right',
        () => ctx.slots.register(
          { name: 'conversation.input.right', id: 'dsh-kitt-voice-options', order: 83 },
          OptionsButton
        )
      );

      ctx.slots.inject(
        'conversation.input.dock',
        () => ctx.slots.register(
          { name: 'conversation.input.dock', id: 'dsh-kitt-voice-status', order: 10, inject: () => ({ bus }) },
          StatusBar
        )
      );

      if (ctx.settingsScope) {
        ctx.slots.inject(
          'settings.plugin.item',
          () => ctx.slots.register(
            {
              name: 'settings.plugin.item',
              id: 'dsh-kitt-voice',
              key: 'dsh-kitt-voice',
              order: 100,
              label: t(L.settingsTitle),
            },
            () => React.createElement(SettingsCard, { scope: ctx.settingsScope.bind({ namespace: 'dsh-kitt-voice' }) })
          )
        );
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

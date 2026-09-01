// La ventana, por dentro.
//
// EN SU PROPIO ARCHIVO, no dentro del HTML. La ventana declara lo que puede
// cargar —`script-src 'self'`— y eso no incluye el código escrito dentro de la
// página. Con el código ahí dentro, no corría NADA: ni la marca, ni los
// botones, ni el estado. La ventana se veía viva y estaba muerta.
//
// Sacarlo aquí es la forma buena de tenerlo: la declaración sigue siendo
// estricta y el código se ejecuta.
  // Esta página NO toca la red: lo hace el proceso principal por ella, y solo
  // para la lista cerrada de rutas de requests.js. Un fetch de una página
  // file:// viaja con «Origin: null» y el guardián del plugin lo rechaza —
  // medido, no supuesto —, así que pedir aquí sería pedir un 403 fijo.
  async function pedirJson(ruta, opciones) {
    const res = await window.overlay.request(ruta, opciones || { method: 'GET' });
    if (!res || res.status < 200 || res.status >= 300 || !res.body) {
      throw new Error((res && res.reason) || 'sin conexión con el arnés');
    }
    return JSON.parse(res.body);
  }

  const stage = document.getElementById('stage');
  const mark = document.getElementById('mark');
  const say  = document.getElementById('say');

  /* ------------------------------------------------------------------ *
   * EL IDIOMA DE LA VENTANA.
   *
   * Es distinto del idioma que se dicta: alguien puede hablarle en español al
   * agente y querer los menús en inglés, y al revés. Por eso son dos ajustes
   * y no uno.
   *
   * Las frases viven en textos.js, no aquí: traducir es un encargo que se le
   * da a alguien, y nadie debería tener que buscarlas entre las funciones.
   * ------------------------------------------------------------------ */
  const T = window.OVERLAY_TEXTOS;
  let idioma = 'es';

  const txt = (clave) => T.frase(clave, idioma);

  /** Reescribe todo lo que hay en pantalla en el idioma actual. */
  function pintarIdioma() {
    for (const el of document.querySelectorAll('[data-txt]')) {
      el.textContent = txt(el.dataset.txt);
    }
    // Los botones de la barra dicen lo suyo al pasar por encima, y eso también
    // se traduce: un botón sin palabras es un botón que hay que adivinar.
    const rotulos = {
      turn: 'turnTitle', talk: 'talkTitle', menu: 'menuTitle',
      quit: 'quitTitle', mark: 'brandTitle', web: 'brandTitle', micmute: 'muteTitle', speak: 'speakTitle',
    };
    for (const [id, clave] of Object.entries(rotulos)) {
      const b = document.getElementById(id);
      if (!b) continue;
      b.title = txt(clave);
      b.setAttribute('aria-label', txt(clave));
    }
    // El estado que se esté mostrando ahora mismo cambia con el resto: dejarlo
    // en el idioma viejo hasta el siguiente cambio se lee como un fallo.
    ultimoTexto = null;
  }

  function fijarIdioma(pedido) {
    idioma = T.resolver(pedido, navigator.language);
    document.documentElement.lang = idioma;
    pintarIdioma();
  }

  // Two shapes: the badge for someone who wants to forget it is there, the sign
  // for someone who wants to see the product. The main process owns the window
  // size, so it tells us which one is current.
  let shape = 'symbol';
  function wear(next) {
    shape = window.OVERLAY_MARKS[next] ? next : 'symbol';
    mark.src = window.OVERLAY_MARKS[shape];
    stage.classList.toggle('symbol', shape === 'symbol');
    stage.classList.toggle('wordmark', shape === 'wordmark');
  }
  wear('symbol');
  window.overlay.onShape(wear);

  // THE COLOURS MEAN SOMETHING, and only one thing each. Three states and no
  // more, because a light you have to interpret is worse than no light:
  //
  //   nada    parado. Parado es parado.
  //   verde   la voz está en marcha — te escucha, o te está hablando.
  //   azul    está trabajando: transcribiendo o pensando. No te oye.
  //   rojo    ALGO HA FALLADO. Y nada más. Regla de la casa, y tiene razón:
  //           si el rojo también sale mientras espera, el rojo deja de
  //           querer decir nada y lo único que dice es «esto no va».

  /* El pulso del sondeo. Aqui hubo tambien una caja de voz de doce
     segmentos que se movia con el; se quito el mismo dia porque distraia. */

  const LOOK = {
    idle:         { colour: null,      word: '' },
    // EN REPOSO: el sistema está encendido y el micrófono abierto, pero no hay
    // ninguna voz. Sin halo y sin palabra, porque no está pasando nada. Antes
    // esto ponía «Escuchando» sin parar y desde fuera eso se lee como «te está
    // grabando entero», que en un puesto con el motor sonando no da ninguna
    // tranquilidad.
    // La palabra ya no va escrita aquí: se pide por su clave a textos.js en el
    // momento de pintarla, que es lo único que funciona cuando el idioma puede
    // cambiar sin recargar la ventana.
    // `colour` es el borde de la barra: el único sitio donde vive el estado.
    armed:        { colour: null,      word: '' },
    listening:    { colour: '#3fbf4a', word: 'listening' },
    // AZUL AL PENSAR, y no ámbar: el ámbar y el rojo de hablar se parecen
    // demasiado de reojo, que es como se mira esto. El azul se distingue del
    // rojo a cualquier distancia y no compite con él.
    transcribing: { colour: '#2f7bff', word: 'transcribing' },
    thinking:     { colour: '#2f7bff', word: 'thinking' },
    // ROJO CUANDO HABLA, como KITT. Pudo recuperarse su color porque la avería
    // dejó de ser un color y pasó a ser una palabra escrita.
    reading:      { colour: '#ff3b30', word: 'reading' },
    error:        { colour: '#ff3b30', word: 'errorWord' },
  };

  let missed = 0;
  let ultimoTexto = null;
  /** Si lo que se enseña ahora es la palabra de averia, que se pinta distinta. */
  let ultimaAveria = false;
  /** El ultimo numero de peticion de menu visto. null = todavia no se ha leido
   *  ninguno, y entonces solo se apunta: abrir el menu al arrancar seria abrir
   *  algo que nadie ha pedido en esta sesion. */
  let ultimoMenuSeq = null;

  const SOMBRA_BASE = 'drop-shadow(0 2px 5px rgba(0,0,0,.5))';
  /** The bar's own shadow, always there so it sits ON the screen
   *  rather than in it. The state colour is added to this. */
  const REPOSO = '0 3px 14px rgba(0,0,0,.55)';

  function paint(mode, level, words, enMarcha, silenciado) {
    const look = LOOK[mode] || LOOK.idle;

    if (!look.colour) {
      mark.style.filter = SOMBRA_BASE;
      stage.style.boxShadow = REPOSO;
      stage.style.borderColor = 'rgba(255,255,255,.13)';
      stage.classList.remove('awake');
    } else {
      // THE WHOLE BAR carries the colour now, not a glow around a small badge.
      // From a driving seat, a hint around a twenty-pixel mark is a hint you
      // will not see; an outlined bar in the corner of the eye is not.
      //
      // Loudness only widens it while there is a measured level; in every
      // other state it is a steady outline and not a fake heartbeat.
      const loud = mode === 'listening' ? Math.min(1, Math.max(0, level || 0)) : 0;
      const cerca = 4 + Math.round(loud * 4);
      const lejos = 13 + Math.round(loud * 10);
      stage.style.borderColor = look.colour;
      stage.style.boxShadow =
        `${REPOSO}, 0 0 ${cerca}px ${look.colour}, 0 0 ${lejos}px ${look.colour}66`;
      mark.style.filter = `${SOMBRA_BASE} drop-shadow(0 0 3px ${look.colour})`;
      stage.classList.add('awake');
    }

    stage.classList.toggle('hablando', mode !== 'idle' && mode !== 'error');
    // Mientras piensa, el borde respira. La respiración la lleva el navegador
    // con una transición larga, no un temporizador nuestro: así es suave de
    // verdad y no se apaga de golpe.
    stage.classList.toggle('pensando', mode === 'thinking' || mode === 'transcribing');
    // El sistema está en marcha: el botón azul se queda encendido hasta que
    // alguien lo apague. Y el rojo, mientras se esté dictando un turno.
    stage.classList.toggle('enmarcha', Boolean(enMarcha));
    // Silenciado: el boton se queda encendido en ambar. Un microfono cerrado
    // que no lo dice es la peor de las dos mentiras posibles.
    stage.classList.toggle('silenciado', Boolean(silenciado));
    // Mientras lee, el altavoz encendido: pulsarlo otra vez lo calla.
    stage.classList.toggle('leyendo', mode === 'reading');
    stage.classList.toggle('grabando', !enMarcha && (mode === 'listening' || mode === 'transcribing'));


    // EN AVERÍA MANDA LA PALABRA, no el mensaje largo del servidor. Esta
    // ventana se mira de reojo: «ERROR» se entiende en el tiempo que dura una
    // mirada, y el detalle de qué ha fallado está en la página del arnés, que
    // es donde se va a leer de verdad.
    const averia = mode === 'error';
    const text = averia ? txt('errorWord') : (words || (look.word ? txt(look.word) : ''));

    // ESTO VA ANTES DE MEDIR, y ese orden es el arreglo.
    //
    // Al poner texto, la marca se aparta y el hueco se hace grande. Pero esta
    // línea estaba DESPUÉS de medir, así que la palabra se medía contra el
    // hueco pequeño —26 píxeles, con «Escuchando» pidiendo 61—, decidía que no
    // cabía y se ponía a desfilar. Y el desfile no se revisa nunca más: para
    // cuando el hueco crecía, la decisión ya estaba tomada.
    //
    // Se veía como una palabra que se va sola por la izquierda sin motivo.
    stage.classList.toggle('talking', Boolean(text));

    if (text !== ultimoTexto || averia !== ultimaAveria) {
      ultimaAveria = averia;
      ultimoTexto = text;
      say.innerHTML = '';
      if (text) {
        const span = document.createElement('span');
        span.className = averia ? 'texto averia' : 'texto';
        span.textContent = text;
        say.appendChild(span);
        // Measured after it is in the page, because how wide a word is depends
        // on the font that actually rendered it, not on a guess.
        const sobra = span.scrollWidth - say.clientWidth;
        if (sobra > 4) {
          span.style.setProperty('--recorrido', `-${sobra + 6}px`);
          span.classList.add('rueda');
        }
      }
    }
  }

  async function tick() {
    try {
      const state = await pedirJson('/dsh-kitt-voice/state');
      missed = 0;
      paint(state.mode, state.level, state.message || state.caption || '', state.conversation, state.muted);
      // El engranaje de la pagina pide que abramos el menu. Llega como un
      // numero que sube: cuando cambia, se abre. La primera lectura solo se
      // apunta el numero de partida, que si no el menu saltaria al arrancar.
      if (state.menuSeq !== undefined) {
        if (ultimoMenuSeq === null) ultimoMenuSeq = state.menuSeq;
        else if (state.menuSeq > ultimoMenuSeq) {
          ultimoMenuSeq = state.menuSeq;
          // Buscado aquí y no por la variable de más abajo: el sondeo arranca
          // antes de que esa línea se haya ejecutado, y una constante a la que
          // se llega antes de tiempo no da vacío, revienta.
          const p = document.getElementById('panel');
          if (p && p.hidden) void openPanel();
        }
      }
    } catch {
      // Never pretend to be connected: a companion that lies is worse than none.
      missed += 1;
      if (missed > 2) paint('idle', 0, '', false, false);
    }
  }

  // El pulso que ya existia mueve tambien el barrido de la caja de voz: ni un
  // reloj nuevo, ni una animacion continua.
  /* EL IDIOMA, AL ARRANCAR Y NO AL ABRIR EL MENÚ.
   *
   * Estaba puesto sólo dentro de la carga del menú, así que hasta que alguien
   * no lo abría, los rótulos de los botones eran los que vienen escritos en el
   * HTML — en español, dijera lo que dijera el ajuste — y la marca no tenía
   * rótulo ninguno. Se veía bien y estaba mal: lo cazó la medición, no la
   * vista. */
  void (async () => {
    try {
      const cfg = await pedirJson('/dsh-kitt-voice/config');
      fijarIdioma(cfg.uiLang);
      stage.classList.toggle('sobrio', cfg.buttonColours === 'sobrio');
    } catch {
      // Sin servidor, el idioma del sistema y los colores de siempre: es lo
      // que hay, y es mejor que quedarse con los rótulos escritos a mano.
      fijarIdioma('auto');
    }
  })();

  setInterval(() => { void tick(); }, 150);
  tick();


  /* ------------------------------------------------------------------ *
   * Assigning keys.
   *
   * The lesson this follows was paid for elsewhere: a "press a key" veil that
   * only listens to the keyboard looks like a hang, and a key it refuses in
   * silence looks broken. So this one closes with a click too, and every
   * refusal says why, in the panel, where the person is looking.
   * ------------------------------------------------------------------ */
  const panel = document.getElementById('panel');
  const rows = document.getElementById('rows');
  const problem = document.getElementById('problem');

  /** Qué hace cada tecla. La clave de la frase, no la frase: el idioma puede
   *  cambiar sin cerrar el menú. */
  const WHAT = {
    'record-toggle': 'actRecord',
    'talk-toggle': 'actTalk',
    // En el mismo orden que los botones de la barra, que es como se busca.
    'mic-mute': 'actMute',
    'speak-last': 'actSpeak',
    'stop-speaking': 'actStop',
    'menu-toggle': 'actMenu',
  };

  let waitingFor = null;
  /** Las teclas tal como las dio el proceso principal, para poder repintar la
   *  lista al cambiar de idioma sin volver a preguntárselas. */
  let ultimasTeclas = {};

  function drawRows(current) {
    ultimasTeclas = current || {};
    rows.textContent = '';
    for (const action of Object.keys(WHAT)) {
      const row = document.createElement('div');
      row.className = 'row';

      const what = document.createElement('div');
      what.className = 'what';
      what.textContent = txt(WHAT[action]);

      const key = document.createElement('button');
      key.className = 'key' + (waitingFor === action ? ' waiting' : '');
      key.textContent = waitingFor === action ? txt('keyWaiting') : (current[action] || txt('keyUnset'));
      key.onclick = () => {
        waitingFor = waitingFor === action ? null : action;
        problem.textContent = waitingFor ? txt('keyPrompt') : '';
        drawRows(current);
      };

      row.append(what, key);
      rows.append(row);
    }
  }

  /** Turn a real key press into the text Electron expects. */
  function asAccelerator(event) {
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');
    if (event.metaKey) parts.push('Super');

    const k = event.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null; // a modifier alone is not a key
    if (k === ' ') parts.push('Space');
    else if (k.length === 1) parts.push(k.toUpperCase());
    else parts.push(k);
    return parts.join('+');
  }

  window.addEventListener('keydown', async (event) => {
    if (panel.hidden) return;
    event.preventDefault();

    if (event.key === 'Escape') { waitingFor = null; problem.textContent = ''; drawRows(await window.overlay.keysList()); return; }
    if (!waitingFor) return;

    const accelerator = asAccelerator(event);
    if (!accelerator) return; // still holding modifiers down

    const result = await window.overlay.keySet(waitingFor, accelerator);
    problem.textContent = result.ok ? '' : result.reason;
    waitingFor = null;
    drawRows(await window.overlay.keysList());
  });

  async function openPanel() {
    // Shown BEFORE anything can fail. The window is resized by captureMode, so
    // if the panel only appeared after two more awaits, one of them failing
    // left a window the size of the menu with nothing but the bar in it.
    problem.textContent = '';
    waitingFor = null;
    panel.hidden = false;
    stage.classList.add('oculta');
    try {
      await window.overlay.captureMode(true);
      drawRows(await window.overlay.keysList());
    } catch (error) {
      problem.textContent = `${txt('keysUnread')}: ${error?.message ?? error}`;
    }
  }
  async function closePanel() {
    panel.hidden = true;
    stage.classList.remove('oculta');
    waitingFor = null;
    await window.overlay.captureMode(false);
  }

  /** One order, sent the same way a wheel button sends it, so both routes end
   *  up in exactly one place — the page, which is what owns the microphone and
   *  the audio. A window that acts on its own drawing instead of ordering the
   *  page is a window that lies about what is happening. */
  /* Hold and move: the bar follows the pointer. Started only on the bar
     itself — pressing a button must not drag the window out from under the
     finger that is pressing it. */
  const agarrar = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, select, input')) return;
    window.overlay.dragStart();
  };
  document.getElementById('panel').addEventListener('mousedown', agarrar);
  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, select, input')) return;
    window.overlay.dragStart();
  });
  window.addEventListener('mouseup', () => window.overlay.dragEnd());
  window.addEventListener('blur', () => window.overlay.dragEnd());

  const ordenar = (name) => {
    window.overlay.request('/dsh-kitt-voice/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => { /* the bar already shows there is no connection */ });
  };

  // The two circles that get used.
  document.getElementById('turn').onclick = () => ordenar('record-toggle');
  document.getElementById('talk').onclick = () => ordenar('talk-toggle');
  document.getElementById('micmute').onclick = () => ordenar('mic-mute');
  document.getElementById('speak').onclick = () => ordenar('speak-last');

  // El aspa: cerrar sin abrir el menú. Cerrarla nunca es un callejón — el
  // plugin la vuelve a abrir en cuanto se usa la voz.
  document.getElementById('quit').onclick = () => window.overlay.close();

  // And the third, which holds everything else.
  document.getElementById('menu').onclick = () => { openPanel(); void cargarSonido(); };
  document.getElementById('done').onclick = closePanel;

  document.getElementById('mute').onclick = () => { ordenar('stop-speaking'); closePanel(); };
  document.getElementById('shape').onclick = () => {
    window.overlay.setShape(shape === 'symbol' ? 'wordmark' : 'symbol');
    closePanel();
  };
  document.getElementById('close').onclick = () => window.overlay.close();

  // La marca y el pie del menú llevan a la web, en el navegador de siempre.
  // La dirección la sabe el proceso principal, no esta página.
  const irALaWeb = () => window.overlay.abrirWeb();
  mark.onclick = irALaWeb;
  const web = document.getElementById('web');
  web.onclick = irALaWeb;
  web.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); irALaWeb(); } };
  mark.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); irALaWeb(); } };
  document.getElementById('marca').onclick = irALaWeb;

  // A key that could not be registered at start-up is reported here rather than
  // left as a button that does nothing in another window.
  window.overlay.onKeyProblem((message) => { problem.textContent = message; });

  // La tecla del menú abre y cierra. Una tecla que sólo abre deja sin salida a
  // quien la pulsa desde otra aplicación: no puede llegar al botón de «Listo»
  // sin abandonar lo que estaba haciendo, que es lo que esto evita.
  window.overlay.onMenuToggle(() => {
    const p = document.getElementById('panel');
    if (!p) return;
    if (p.hidden) void openPanel(); else void closePanel();
  });

  /* ------------------------------------------------------------------ *
   * Sound, chosen from here.
   *
   * Until now the microphone, the speaker and the voice could only be
   * changed by editing a file — which means only whoever wrote the file
   * could change them. On a rig with seven audio outputs that is not a
   * detail: it is the difference between hearing the answer and thinking
   * the thing is broken.
   *
   * This window cannot ask the browser what is plugged in — no window can
   * ask another — so the page tells the harness, and this reads it there.
   * ------------------------------------------------------------------ */

  const llenar = (select, nombres, elegido, porDefecto) => {
    select.innerHTML = '';
    const opciones = [{ v: '', t: porDefecto }].concat(nombres.map((n) => ({ v: n, t: n })));
    for (const o of opciones) {
      const el = document.createElement('option');
      el.value = o.v;
      // The full name in the tooltip: these are long and the box is narrow.
      el.textContent = o.t;
      el.title = o.t;
      select.appendChild(el);
    }
    select.value = opciones.some((o) => o.v === elegido) ? elegido : '';
  };

  const IDIOMA = () => ({ es: txt('langEs'), en: txt('langEn'), zh: txt('langZh') });

  /* La casa de cada idioma va primera. Ciento y pico voces ordenadas por el
     código del país dejan «Argentina» antes que «España», que no es lo que
     busca nadie que abra esta lista. */
  const CASA = { es: 'es-ES', en: 'en-GB', zh: 'zh-CN' };

  /** «es-AR» -> «Argentina». Lo traduce el propio sistema, así que no hay una
   *  tabla de países aquí que se quede vieja. */
  let nombraPais = (codigo) => codigo;
  try {
    const nombres = new Intl.DisplayNames(['es'], { type: 'region' });
    nombraPais = (codigo) => nombres.of(codigo.split('-')[1] || codigo) || codigo;
  } catch { /* un navegador sin esto enseña el código, que tampoco engaña */ }

  /** «es-CO-SalomeNeural» -> «Salomé». El resto ya está en su columna. */
  const nombraVoz = (id) => id.replace(/Neural$/, '').replace(/^[a-z]{2}-[A-Z]{2}-/, '');

  async function llenarVoces(elegida) {
    const sel = document.getElementById('voice');
    sel.innerHTML = '';
    const suelta = (texto, valor) => {
      const o = document.createElement('option');
      o.value = valor; o.textContent = texto; o.title = texto;
      return o;
    };
    sel.appendChild(suelta(txt('systemVoice'), ''));

    let datos = { local: [], neural: [] };
    try { datos = await pedirJson('/dsh-kitt-voice/voices'); } catch { /* lista corta */ }

    for (const clave of ['es', 'en', 'zh']) {
      const suyas = (datos.neural || []).filter((v) => String(v.language).startsWith(clave + '-'));
      if (!suyas.length) continue;
      suyas.sort((a, b) => {
        // La casa primero; después, por país, en orden alfabético de verdad
        // (con tildes y todo, que es lo que espera quien lo lee).
        const ca = a.language === CASA[clave] ? 0 : 1;
        const cb = b.language === CASA[clave] ? 0 : 1;
        if (ca !== cb) return ca - cb;
        const pa = nombraPais(a.language), pb = nombraPais(b.language);
        if (pa !== pb) return pa.localeCompare(pb, 'es');
        return nombraVoz(a.id).localeCompare(nombraVoz(b.id), 'es');
      });
      const g = document.createElement('optgroup');
      g.label = IDIOMA()[clave];
      for (const v of suyas) {
        g.appendChild(suelta(`${nombraVoz(v.id)} · ${nombraPais(v.language)} · ${v.gender}`, v.id));
      }
      sel.appendChild(g);
    }

    if ((datos.local || []).length) {
      const g = document.createElement('optgroup');
      g.label = txt('localVoices');
      for (const v of datos.local) g.appendChild(suelta(v.id, v.id));
      sel.appendChild(g);
    }
    sel.value = [...sel.querySelectorAll('option')].some((o) => o.value === elegida) ? elegida : '';
  }

  /* La velocidad de lectura, en pasos.
     Escuchar no es leer: una respuesta larga a un ritmo que no es el tuyo se
     sigue mal. Los pasos van de la mitad al doble, que es lo que aguanta una
     voz sin sonar a cinta rebobinada. */
  /* El número y nada más. «Lento» y «Algo rápido» no dicen cuánto, y quien
     ajusta esto quiere comparar dos valores, no leer un adjetivo. */
  const RITMOS = ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2'];

  function llenarRitmos(elegido) {
    const sel = document.getElementById('rate');
    sel.innerHTML = '';
    for (const valor of RITMOS) {
      const o = document.createElement('option');
      o.value = valor;
      o.textContent = valor === '1' ? txt('rateNormal') : `x${valor}`;
      sel.appendChild(o);
    }
    // Lo guardado puede no caer justo en un paso (los ajustes admiten
    // cualquier número): se marca el paso más cercano en vez de no marcar
    // ninguno, que se leería como «Muy lento» sin serlo.
    const n = Number(elegido);
    const actual = Number.isFinite(n) && n > 0 ? n : 1;
    let mejor = '1';
    let cerca = Infinity;
    for (const valor of RITMOS) {
      const d = Math.abs(Number(valor) - actual);
      if (d < cerca) { cerca = d; mejor = valor; }
    }
    sel.value = mejor;
  }

  /** La lista de idiomas, con su bandera delante. */
  function llenarIdiomas(elegido) {
    const sel = document.getElementById('uilang');
    sel.innerHTML = '';
    for (const l of T.IDIOMAS) {
      const o = document.createElement('option');
      o.value = l.code;
      // El nombre de cada idioma va EN ESE IDIOMA: quien busca el suyo lo
      // reconoce aunque la ventana esté ahora mismo en uno que no entiende.
      o.textContent = `${l.flag}  ${l.name}`;
      sel.appendChild(o);
    }
    sel.value = T.IDIOMAS.some((l) => l.code === elegido) ? elegido : 'auto';
  }

  /* EL COLOR DE LOS MANDOS: uno cada uno, o todos en blanco.
     El color ayuda a saber qué botón es sin leer, pero hay a quien una barra
     con colores encima de lo suyo le canta demasiado. Lo que NO cambia en
     ningún caso es el borde: eso no es adorno, es el estado. */
  function llenarPaleta(elegida) {
    const sel = document.getElementById('paleta');
    sel.innerHTML = '';
    for (const [valor, clave] of [['color', 'colorEach'], ['sobrio', 'colorPlain']]) {
      const o = document.createElement('option');
      o.value = valor; o.textContent = txt(clave);
      sel.appendChild(o);
    }
    sel.value = elegida === 'sobrio' ? 'sobrio' : 'color';
    stage.classList.toggle('sobrio', elegida === 'sobrio');
  }

  async function cargarSonido() {
    try {
      const [cfg, dev] = await Promise.all([
        pedirJson('/dsh-kitt-voice/config'),
        pedirJson('/dsh-kitt-voice/devices'),
      ]);
      fijarIdioma(cfg.uiLang);
      llenarIdiomas(cfg.uiLang || 'auto');
      llenar(document.getElementById('mic'), dev.inputs || [], cfg.micLabel || '', txt('systemDevice'));
      llenar(document.getElementById('out'), dev.outputs || [], cfg.outputLabel || '', txt('systemDevice'));
      llenarRitmos(cfg.speechRate);
      llenarPaleta(cfg.buttonColours);
      await llenarVoces(cfg.voice || '');
    } catch { /* the bar already shows there is no connection */ }
  }

  const guardar = (patch) => {
    window.overlay.request('/dsh-kitt-voice/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => { /* the next open will show it did not take */ });
  };

  document.getElementById('mic').onchange = (e) => guardar({ micLabel: e.target.value });
  document.getElementById('out').onchange = (e) => guardar({ outputLabel: e.target.value });
  document.getElementById('voice').onchange = (e) => guardar({ voice: e.target.value });
  document.getElementById('rate').onchange = (e) => guardar({ speechRate: Number(e.target.value) });
  document.getElementById('paleta').onchange = (e) => {
    stage.classList.toggle('sobrio', e.target.value === 'sobrio');
    guardar({ buttonColours: e.target.value });
  };

  document.getElementById('uilang').onchange = (e) => {
    // Se aplica ANTES de guardarlo: el cambio de idioma se tiene que ver en el
    // momento de elegirlo, no cuando el servidor conteste. Y si el guardado
    // falla, la próxima vez que se abra el menú vuelve al que estaba, que es
    // lo honesto.
    fijarIdioma(e.target.value);
    drawRows(ultimasTeclas);
    llenarRitmos(document.getElementById('rate').value);
    guardar({ uiLang: e.target.value });
  };


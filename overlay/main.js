'use strict';
/**
 * The companion window.
 *
 * A plugin lives inside a web page, and a web page cannot be seen while you are
 * in a fullscreen game. That is the whole reason this exists: a small window
 * that floats above everything and tells you what the voice is doing while you
 * are somewhere else entirely.
 *
 * It owns no microphone and no audio. It reads the plugin's published state and
 * draws it. If the plugin is not running, it says so instead of pretending.
 */

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const shortcuts = require('./shortcuts');
const requests = require('./requests');

/**
 * Two shapes, because one size does not suit both uses: the badge is for
 * someone who wants to forget it is there, the sign is for someone who wants to
 * see the product from across the room (and for a screenshot).
 */
const SHAPES = {
  // The window must be BIGGER than the mark plus the widest the glow can
  // spread, on every side. A window that fits the mark clips the glow at its
  // edge, and a clipped glow reads as a rectangular patch of colour stuck on
  // the screen — the exact thing this window must never look like.
  // A bar, not a badge: as wide as its controls need and no taller than a
  // finger. The two shapes differ only in whether the mark is the symbol or
  // the full logotype.
  // Wide enough for the state to be READ. «Escribiendo» in a bar sized to the
  // buttons was «Escr…», and half of «Escribiendo» and half of «Escuchando»
  // look the same.
  // Widened when the close circle joined the bar: a fourth button is 26 px
  // plus its gap, and the room the state word needs was measured, not shared.
  // MÁS PEQUEÑA. La barra nació de 44 de alto y con la caja de voz llegó a 322
  // de ancho; sin la caja y con los mandos ajustados cabe en 36 de alto, que es
  // la altura de la fila de herramientas del propio arnés. La idea es que las
  // dos superficies —la de la página y ésta— se parezcan hasta en el tamaño:
  // son los mismos tres mandos y no deberían verse como dos productos.
  // Un mando mas (silenciar): 24 px de boton y su hueco.
  // Seis mandos: hablar, conversar, silenciar, leer, menu y cerrar. Los mismos
  // que la fila del arnes, porque son el mismo mando en dos sitios.
  symbol:   { width: 300, height: 36 },
  wordmark: { width: 348, height: 36 },
};

/** The window grows to this while the keys are being assigned. */
// Taller than before: the menu now holds the actions that used to be
// circles of their own.
// Measured, not guessed: with the speed control the panel asks for 455 pixels
// of content. A window sized to the exact number is a window that clips itself
// the day a font renders one pixel taller, so it gets room.
const PANEL = { width: 300, height: 628 };
const DEFAULT_SHAPE = 'symbol';

/**
 * Where the plugin answers.
 *
 * Loopback only, and only a port: this window must never be talked into
 * reaching a host somebody else controls, so the address is assembled here from
 * a number rather than accepted as a URL. The harness's port is a choice the
 * person makes when they start it, so it is configurable — but the host is not.
 */
const DEFAULT_PORT = 3081;

function pluginPort() {
  const raw = Number.parseInt(process.env.DSH_KITT_PORT || '', 10);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PORT;
}

function pluginUrl(pathname) {
  return `http://127.0.0.1:${pluginPort()}/dsh-kitt-voice${pathname}`;
}

/**
 * Turn a key press into an order for the page.
 *
 * Deliberately fire-and-forget. The person is in another window with both hands
 * busy; a failure here must never block the key, and if the harness is not
 * running the window already shows that on its own.
 */
function sendOrder(name) {
  /* EL MENÚ NO SALE DE CASA.
   *
   * Las demás teclas son recados para la página —grabar, conversar, silenciar,
   * leer— y viajan por el arnés. Abrir el menú de esta ventana es cosa de esta
   * ventana: mandarlo a dar la vuelta por el servidor sería pedirle a la
   * página que haga algo que no puede hacer, y encima dejaría el menú sin
   * funcionar cuando el arnés está caído, que es justo cuando más falta hace
   * poder mirar los ajustes. */
  if (name === 'menu-toggle') {
    if (win && !win.isDestroyed()) win.webContents.send('overlay:menu-toggle');
    return;
  }

  fetch(pluginUrl('/command'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => { /* the window is already showing there is no connection */ });
}

let keys = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'overlay.json');
}
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch { return {}; }
}
function writeSettings(next) {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...next })); }
  catch { /* forgetting the position is not worth a crash */ }
}

/** Keep the window on a screen that actually exists: monitors get unplugged. */
function safePosition(saved, size) {
  const area = screen.getPrimaryDisplay().workArea;
  const corner = { x: area.x + area.width - size.width - 24, y: area.y + 24 };
  if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') return corner;
  const onAScreen = screen.getAllDisplays().some((display) =>
    saved.x + size.width > display.workArea.x && saved.x < display.workArea.x + display.workArea.width &&
    saved.y + size.height > display.workArea.y && saved.y < display.workArea.y + display.workArea.height);
  return onAScreen ? { x: saved.x, y: saved.y } : corner;
}

let win = null;

/** Where the window is, and NOTHING about how big it is. A size stored here
 *  comes back on the next start and makes a wrong size permanent. */
function posicionDeLaVentana() {
  const [x, y] = win.getPosition();
  return { x, y };
}


function createWindow() {
  const settings = readSettings();
  const shape = SHAPES[settings.shape] ? settings.shape : DEFAULT_SHAPE;
  const size = SHAPES[shape];
  const pos = safePosition(settings.position, size);

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y,
    // The recipe already proven to float over a fullscreen sim on this machine:
    // no frame, real transparency, no shadow, always on top.
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Never steal focus: appearing must not pull the person out of their game.
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Stated rather than inherited: these are the settings that keep a
      // window safe, and a default that changes in a future Electron must not
      // change them silently.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      // Without this the window is throttled the moment it is not focused —
      // which is exactly when it has to keep working.
      backgroundThrottling: false,
    },
  });

  // 'screen-saver' is the level that clears a fullscreen game on Windows.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // This window shows one local page and nothing else, ever. Anything trying
  // to navigate it elsewhere, or to open a second window, is refused: a
  // companion that can be steered to a remote page is a companion with a
  // preload attached to somebody else's code.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // LO QUE PASA DENTRO DE LA VENTANA, FUERA.
  //
  // Un error en la página no sale por ningún sitio: la ventana no tiene barra,
  // no tiene menú y nadie va a abrirle las herramientas de desarrollo. Así que
  // se queda una barra que se ve perfectamente y no hace nada, y no hay dónde
  // mirar. Con esto, un fallo dentro se lee en el mismo registro que todo lo
  // demás. Esto no es andamio: es la única ventana que tiene esta ventana.
  win.webContents.on('console-message', (_e, nivel, mensaje, linea, origen) => {
    if (nivel < 2) return;   // avisos y errores; la charla y el detalle, no
    // La marca privada es opcional y lo normal es que NO esté: su «no
    // encontrado» de cada arranque no es un fallo, y un registro que avisa en
    // cada arranque enseña a no leerlo.
    if (`${mensaje} ${origen}`.includes('marks.local.js')) return;
    const donde = origen ? ` (${String(origen).split('/').pop()}:${linea})` : '';
    console.error(`[dsh-kitt-voice · ventana] ${mensaje}${donde}`);
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    win.webContents.send('overlay:shape', shape);
    win.showInactive();
  });
  win.on('moved', () => writeSettings({ position: posicionDeLaVentana() }));
}

ipcMain.on('overlay:close', () => { if (win) win.close(); });

/**
 * LA WEB DEL PLUGIN, en el navegador de siempre.
 *
 * La dirección está ESCRITA AQUÍ y la página no la elige: el renderer sólo
 * puede decir «abre la web», nunca «abre esto». Si pudiera pasar una dirección,
 * cualquier fallo en la página se convertiría en abrirle a alguien lo que
 * quisiera un tercero — y esta ventana ya tiene prohibido navegar por eso mismo.
 *
 * `openExternal` y no una ventana nuestra: lo que se abre es una web, y una web
 * se ve en el navegador, no dentro de una barra flotante.
 */
const WEB = 'https://kittcat.com';
ipcMain.on('overlay:web', () => {
  shell.openExternal(WEB).catch(() => { /* sin navegador no hay nada que hacer */ });
});

/**
 * Las peticiones de la ventana, por el proceso principal.
 *
 * La página de la ventana es file://, y un fetch de una página file:// a
 * loopback viaja con «Origin: null» — que el guardián del plugin rechaza a
 * propósito, porque también lo mandan los iframes de cualquier web. Medido con
 * el propio guardián. Así que la ventana no toca la red: lo hace este proceso,
 * que no es un navegador y no manda Origin, y SOLO para la lista cerrada de
 * requests.js. Lo privilegiado pasa por una API controlada, nunca por el fetch
 * del renderer.
 */
ipcMain.handle('overlay:request', async (_event, ruta, opciones) => {
  const metodo = String((opciones && opciones.method) || 'GET').toUpperCase();
  if (!requests.rutaPermitida(metodo, ruta)) return { ok: false, status: 403, reason: 'Not allowed.' };
  const url = requests.urlDelArnes(pluginPort(), ruta);
  if (!url) return { ok: false, status: 403, reason: 'Not allowed.' };
  try {
    // Del renderer sólo pasa el tipo de contenido: un conducto privilegiado
    // no reenvía cabeceras que no necesita.
    const tipo = opciones && opciones.headers && opciones.headers['content-type'];
    const respuesta = await fetch(url, {
      method: metodo,
      headers: tipo ? { 'content-type': String(tipo) } : undefined,
      body: (opciones && opciones.body) || undefined,
    });
    const texto = await respuesta.text();
    return { ok: respuesta.ok, status: respuesta.status, body: texto };
  } catch (error) {
    return { ok: false, status: 0, reason: String((error && error.message) || error) };
  }
});

ipcMain.handle('overlay:keys-list', () => (keys ? keys.list() : {}));

/**
 * Assigning a key needs the keyboard, and this window is built NOT to take
 * focus — that is the whole point of it. So focus is borrowed for exactly as
 * long as the panel is open and handed straight back.
 */
ipcMain.handle('overlay:capture-mode', (_event, open) => {
  if (!win) return { ok: false };
  const settings = readSettings();
  const shape = SHAPES[settings.shape] ? settings.shape : DEFAULT_SHAPE;
  const size = open ? PANEL : SHAPES[shape];
  const here = win.getBounds();
  win.setBounds({ x: here.x, y: here.y, width: size.width, height: size.height });
  win.setFocusable(Boolean(open));
  if (open) win.focus();
  else {
    win.blur();
    // EL FANTASMA, OTRA VEZ, PERO AL ENCOGER.
    //
    // Al cerrar el menú la ventana pasa de 480 de alto a 44, y lo que ocupaba
    // el panel se queda pintado en la pantalla: se ve un trozo del menú
    // colgando debajo de la barra, que no responde a nada. Es lo mismo que la
    // sombra al arrastrar —Windows no repinta lo que había detrás de una
    // ventana transparente— pero los dos interruptores de arranque no lo
    // cubren, porque aquí no se mueve nada: desaparece superficie.
    //
    // Esconderla y volver a mostrarla obliga al escritorio a repintar esa
    // zona. `showInactive` y no `show`, que esta ventana no roba el foco jamás.
    win.hide();
    win.showInactive();
    writeSettings({ position: posicionDeLaVentana() });
  }
  return { ok: true };
});

ipcMain.handle('overlay:key-set', (_event, action, accelerator) => {
  if (!keys) return { ok: false, reason: 'Shortcuts are not ready yet.' };
  const result = keys.set(action, accelerator);
  if (result.ok) writeSettings({ shortcuts: keys.list() });
  return result;
});

/** Switch shape without losing the corner the window was parked in. */
ipcMain.on('overlay:set-shape', (_event, requested) => {
  const shape = SHAPES[requested] ? requested : DEFAULT_SHAPE;
  const size = SHAPES[shape];
  writeSettings({ shape });
  if (!win) return;
  const here = win.getBounds();
  win.setBounds({ x: here.x, y: here.y, width: size.width, height: size.height });
  win.webContents.send('overlay:shape', shape);
  writeSettings({ position: posicionDeLaVentana() });
});

/* -------------------------------------------------------------------------
 * THE GHOST.
 *
 * Moving this window left a copy of itself behind on the screen: a bar you can
 * see, that answers nothing when you press it, and that stays there. It was
 * hit from the first day of use, and it took a while to accept it was not a
 * second window.
 * It is not. It is the desktop not being repainted where a transparent,
 * frameless, always-on-top window used to be — Windows works out what is
 * hidden behind what, decides nothing changed, and never redraws it.
 *
 * Two switches, both before the app starts, because after that they do nothing:
 *
 *   - the occlusion calculation is what makes that wrong decision;
 *   - and compositing this on the graphics card is what leaves the stale
 *     pixels. For a bar of two hundred pixels with no animation, drawing it on
 *     the processor costs nothing anybody can measure and removes the whole
 *     class of fault.
 * ---------------------------------------------------------------------- */
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.disableHardwareAcceleration();

/* ONE window, whoever asks for it.
 *
 * The plugin opens this by itself when the voice is used, and a person can
 * open it too. Without this, both happen and there are two — which is exactly
 * the confusion the ghost above already causes on its own. */
const soyElUnico = app.requestSingleInstanceLock();
if (!soyElUnico) {
  // AND IT TOUCHES NOTHING ON THE WAY OUT. Quitting is asynchronous, so the
  // losing instance still reached `whenReady`, failed to register keys the
  // winner already held, and wrote that failure — four nulls — over the good
  // settings. Every key stopped working and nothing said so.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) win.showInactive();
  });
}

app.whenReady().then(() => {
  if (!soyElUnico) return;
  keys = shortcuts.create({
    send: sendOrder,
    onError: (message) => {
      // A key that quietly does not work is the worst outcome: the person is in
      // another window and would never find out. It goes to the window instead.
      if (win) win.webContents.send('overlay:key-problem', message);
    },
  });
  const registered = keys.restore(readSettings().shortcuts);
  writeSettings({ shortcuts: registered });
  createWindow();
});

// Global shortcuts belong to the whole machine: give them back on the way out.
app.on('will-quit', () => { if (keys) keys.releaseAll(); });
app.on('window-all-closed', () => app.quit());

/* -------------------------------------------------------------------------
 * Dragging, by hand.
 *
 * The window is deliberately `focusable: false` so that appearing mid-corner
 * never pulls you out of a game. The price is that Windows does not send it
 * the click that the usual `-webkit-app-region: drag` needs, so the bar simply
 * would not move — which is exactly what was found the moment it was tried.
 *
 * So the pointer is followed from here instead: the renderer says when a drag
 * starts and ends, and in between the main process reads the cursor and moves
 * the window under it. Reading the cursor works whether or not anything has
 * focus.
 * ---------------------------------------------------------------------- */
let arrastre = null;

function empezarArrastre() {
  if (!win || arrastre) return;
  const cursor = screen.getCursorScreenPoint();
  const caja = win.getBounds();
  // THE SIZE IS NEVER READ BACK. It is stated, from the table, every single
  // time the window is placed.
  //
  // Measured: dragging inflated the bar from 258x44 to 276x62, and it kept
  // going for as long as you held it — «largo, largo, largo». On a display
  // that is not at 100%, every round trip through the window's own geometry
  // picks up a rounding error, and the error only ever goes one way. Reading
  // the size back and handing it straight in again does that sixty times a
  // second. Asserting a constant cannot drift.
  const ajustes = readSettings();
  const forma = SHAPES[ajustes.shape] ? ajustes.shape : DEFAULT_SHAPE;
  const medida = SHAPES[forma];
  arrastre = {
    medida,
    dx: cursor.x - caja.x,
    dy: cursor.y - caja.y,
    // ~60 a second. Slower and the window lags behind the pointer, which feels
    // broken; faster buys nothing the eye can see.
    reloj: setInterval(() => {
      if (!win || win.isDestroyed()) return terminarArrastre();
      const ahora = screen.getCursorScreenPoint();
      win.setBounds({
        x: ahora.x - arrastre.dx,
        y: ahora.y - arrastre.dy,
        width: arrastre.medida.width,
        height: arrastre.medida.height,
      });
    }, 16),
  };
}

function terminarArrastre() {
  if (!arrastre) return;
  clearInterval(arrastre.reloj);
  arrastre = null;
  // Only where it was left. Storing a size here is how a wrong size becomes
  // permanent: the next start would read it back and honour it.
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition();
    writeSettings({ position: { x, y } });
  }
}

ipcMain.on('overlay:drag-start', empezarArrastre);
ipcMain.on('overlay:drag-end', terminarArrastre);

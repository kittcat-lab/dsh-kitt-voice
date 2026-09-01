'use strict';
/**
 * LO QUE DICE LA VENTANA, EN CADA IDIOMA.
 *
 * En su propio fichero y no repartido por el código: traducir es una tarea que
 * se le encarga a alguien —o a un modelo— y nadie debería tener que buscar las
 * frases entre las funciones para hacerlo. Aquí están todas, y sólo están aquí.
 *
 * PARA AÑADIR UN IDIOMA: añade su código a `IDIOMAS` con su bandera, y a cada
 * frase de abajo su traducción. Lo que falte cae al inglés, y si tampoco está,
 * al español — nunca a un hueco, porque media ventana en blanco es peor que
 * media ventana en otro idioma.
 *
 * El chino no es un capricho: el arnés es de DeepSeek y la mayor parte de
 * quien lo usa escribe en chino. Un plugin que no les habla no lo instalan.
 */

const IDIOMAS = [
  { code: 'auto', flag: '🌐', name: 'Auto' },
  { code: 'es', flag: '🇪🇸', name: 'Español' },
  { code: 'en', flag: '🇬🇧', name: 'English' },
  { code: 'zh', flag: '🇨🇳', name: '中文' },
];

/** El orden de las traducciones en cada lista de abajo. */
const ORDEN = ['es', 'en', 'zh'];

const FRASES = {
  // Los tres estados que la barra escribe a su lado.
  listening:    ['Escuchando', 'Listening', '正在聆听'],
  transcribing: ['Escribiendo', 'Transcribing', '正在转写'],
  thinking:     ['Pensando', 'Thinking', '正在思考'],
  reading:      ['Hablando', 'Speaking', '正在朗读'],
  error:        ['Algo ha fallado', 'Something failed', '出错了'],
  // La palabra que sustituye al color rojo de aviso. Corta a propósito: se lee
  // en el tiempo que dura una mirada de reojo, y el detalle de qué ha fallado
  // está en la página del arnés, que es donde se va a leer de verdad.
  errorWord:    ['ERROR', 'ERROR', '错误'],

  // Los botones de la barra. Dos textos: el que se lee al pasar por encima y
  // el que lee un lector de pantalla, que aquí coinciden.
  // Los rótulos dicen QUÉ PASA AL PULSAR, no cómo se llama el botón. «Hablar y
  // enviar» no explica que hay que volver a pulsar para terminar, y quien lo
  // prueba la primera vez se queda hablando sin que pase nada.
  turnTitle:    [
    'Push to talk — pulsa, habla, y pulsa otra vez para enviar',
    'Push to talk — press, speak, press again to send',
    '按键说话 — 按一次开始，说完再按一次发送',
  ],
  talkTitle:    [
    'Modo KITT — conversación continua, sin tocar nada más',
    'KITT mode — hands-free conversation, nothing else to press',
    'KITT 模式 — 免提连续对话，无需再按任何键',
  ],
  muteTitle:    [
    'Silenciar el micrófono — deja de escucharte hasta que lo quites',
    'Mute the microphone — it stops listening until you unmute',
    '静音麦克风 — 取消静音前不再聆听',
  ],
  speakTitle:   ['Leer los mensajes', 'Read the messages', '朗读消息'],
  menuTitle:    ['Menú', 'Menu', '菜单'],
  quitTitle:    ['Cerrar', 'Close', '关闭'],
  // La marca es también el anuncio: quien instala el plugin ve de un vistazo
  // cuál es y de dónde sale, y de un clic llega a su sitio.
  brandTitle:   [
    'DSH KITT — kittcat.com',
    'DSH KITT — kittcat.com',
    'DSH KITT — kittcat.com',
  ],
  // Lo que pone la barra cuando NO está pasando nada. Ese hueco estaba vacío
  // —es el sitio del estado, y en reposo no hay estado que contar—, así que es
  // el único donde una marca no le quita el sitio a nada. Y en cuanto pasa algo
  // de verdad, desaparece sola.
  brandIdle:    ['kittcat.com', 'kittcat.com', 'kittcat.com'],

  // El menú.
  soundTitle:   ['Sonido', 'Sound', '声音'],
  micLabel:     ['Micrófono', 'Microphone', '麦克风'],
  outLabel:     ['Altavoz', 'Speaker', '扬声器'],
  voiceLabel:   ['Voz', 'Voice', '语音'],
  rateLabel:    ['Velocidad', 'Speed', '语速'],
  langLabel:    ['Idioma', 'Language', '语言'],
  colorLabel:   ['Botones', 'Buttons', '按钮'],
  colorEach:    ['Un color cada uno', 'A colour each', '各自配色'],
  colorPlain:   ['Todos en blanco', 'All white', '全部白色'],
  systemDevice: ['El del sistema', 'System default', '系统默认'],
  systemVoice:  ['La del sistema', 'System voice', '系统语音'],
  rateNormal:   ['x1 (normal)', 'x1 (normal)', 'x1（正常）'],

  keysTitle:    ['Teclas', 'Keys', '快捷键'],
  keysHint:     [
    'Funcionan aunque estés en otra aplicación. Mapea un botón del volante a la tecla que elijas.',
    'They work while you are in another application. Map any button to the key you choose.',
    '在其他应用中同样有效。可将方向盘按钮映射为你选择的按键。',
  ],
  keyUnset:     ['sin asignar', 'not set', '未设置'],
  keyWaiting:   ['pulsa una tecla…', 'press a key…', '请按一个键…'],
  keyPrompt:    [
    'Pulsa la tecla, o vuelve a hacer clic para dejarlo como estaba.',
    'Press the key, or click again to leave it as it was.',
    '请按键，或再次点击取消',
  ],
  keysUnread:   [
    'No se han podido leer las teclas',
    'The keys could not be read',
    '无法读取快捷键',
  ],

  // Lo que hace cada tecla, con los mismos nombres que los botones.
  actRecord:    ['Hablar y enviar', 'Speak and send', '说话并发送'],
  actTalk:      ['Conversación', 'Conversation', '连续对话'],
  actMute:      ['Silenciar el micrófono', 'Mute the microphone', '静音麦克风'],
  actSpeak:     ['Escuchar respuesta', 'Hear the reply', '朗读回复'],
  actStop:      ['Callar', 'Be quiet', '停止朗读'],
  actMenu:      ['Abrir el menú', 'Open the menu', '打开菜单'],

  mute:         ['Callar', 'Be quiet', '停止朗读'],
  shape:        ['Forma', 'Shape', '外观'],
  close:        ['Cerrar', 'Close', '关闭'],
  done:         ['Listo', 'Done', '完成'],

  // Los grupos de la lista de voces.
  langEs:       ['Español', 'Spanish', '西班牙语'],
  langEn:       ['Inglés', 'English', '英语'],
  langZh:       ['Chino', 'Chinese', '中文'],
  localVoices:  [
    'En esta máquina (sin internet)',
    'On this machine (offline)',
    '本机（离线）',
  ],
};

/** El idioma efectivo: el pedido, o el del sistema cuando es «auto». */
function resolver(pedido, delSistema) {
  const p = String(pedido || 'auto').toLowerCase();
  const cual = (p === 'auto' || !p)
    ? String(delSistema || 'es').slice(0, 2).toLowerCase()
    : p.split('-')[0];
  return ORDEN.includes(cual) ? cual : 'en';
}

/** Una frase en el idioma dado, con las dos caídas escritas arriba. */
function frase(clave, idioma) {
  const lista = FRASES[clave];
  if (!lista) return '';
  const i = ORDEN.indexOf(idioma);
  return lista[i] || lista[1] || lista[0] || '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IDIOMAS, ORDEN, FRASES, resolver, frase };
}
if (typeof window !== 'undefined') {
  window.OVERLAY_TEXTOS = { IDIOMAS, ORDEN, FRASES, resolver, frase };
}

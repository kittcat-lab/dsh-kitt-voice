/**
 * Who is allowed to talk to this plugin.
 *
 * The harness serves on loopback, which is often mistaken for "private". It is
 * not. Any web page the person visits can make their browser send requests to
 * 127.0.0.1, and without a check those requests arrive here indistinguishable
 * from the harness's own. For a plugin that opens a microphone and speaks out
 * loud, that is not a theoretical problem: a page could start a recording, or
 * read back the folder layout of the machine.
 *
 * So every route asks two questions before doing anything:
 *
 *   1. did this arrive on the loopback interface, and
 *   2. does it claim an origin we recognise?
 *
 * A request with no Origin header is allowed: that is a direct call (the
 * companion window's main process, curl, a health check), not a browser
 * acting on behalf of some other site. A request WITH an origin must name
 * this same server — same loopback spelling, same port. Origin and Host are
 * both written by whoever calls, so they are never trusted to agree with
 * each other: the port the harness actually listens on is what ties them.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/** Strip the port and brackets from a socket address or Host header. */
function hostOf(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.startsWith('[')) return text.slice(1, text.indexOf(']'));
  const colon = text.lastIndexOf(':');
  // A bare IPv6 address has several colons and no port.
  if (colon > 0 && text.indexOf(':') === colon) return text.slice(0, colon);
  return text;
}

export function isLoopback(req) {
  const socket = req?.socket?.remoteAddress;
  // LA DIRECCIÓN DE VERDAD MANDA, Y SI LA HAY NO SE MIRA NADA MÁS.
  //
  // Antes, si el zócalo daba una dirección que no era local, se caía a la
  // cabecera `Host` — y esa la escribe quien llama. Medido: una petición desde
  // 192.168.1.40 con `Host: 127.0.0.1` pasaba el guardián entero. Con el
  // puerto alcanzable desde la red, eso es cualquiera transcribiendo, leyendo
  // la última respuesta o disparando descargas.
  //
  // La cabecera sólo vale cuando NO hay dirección — que es lo que quería decir
  // el comentario de antes y no lo que hacía el código.
  if (socket) return LOOPBACK.has(hostOf(socket));
  return LOOPBACK.has(hostOf(req?.headers?.host));
}

/** El puerto de un «host[:puerto]» o «[v6]:puerto»; '' cuando no lo lleva. */
function portOf(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.startsWith('[')) {
    const cierre = text.indexOf(']');
    if (cierre === -1) return '';
    return text.slice(cierre + 1).replace(/^:/, '');
  }
  const colon = text.lastIndexOf(':');
  if (colon <= 0 || text.indexOf(':') !== colon) return '';
  return text.slice(colon + 1);
}

/** ¿Es «hostConPuerto» una grafía de loopback con el puerto exacto? */
function esLoopbackConPuerto(hostConPuerto, puerto) {
  return LOOPBACK.has(hostOf(hostConPuerto)) && portOf(hostConPuerto) === String(puerto);
}

/**
 * isSameOrigin(req, expectedPort) — ¿puede esta petición venir de una página
 * de este mismo servidor?
 *
 * Con el puerto del arnés delante (siempre, en producción), el origen y el
 * Host tienen que ser, cada uno por su cuenta, una grafía de loopback CON ESE
 * PUERTO. Comparar Origin contra Host no sirve: las dos cabeceras las escribe
 * quien llama, y un dominio rebindado a 127.0.0.1 las hace coincidir sin ser
 * este servidor. Y sin exigir el puerto, cualquier página de cualquier puerto
 * de 127.0.0.1 pasa por «este mismo servidor». Las dos cosas, medidas.
 *
 * Sin puerto esperado no hay nada a lo que atar las cabeceras, y se comparan
 * entre sí como hacía esto antes: solo ocurre en llamadas directas al módulo
 * y en las pruebas. El plugin siempre pasa el puerto del arnés.
 */
export function isSameOrigin(req, expectedPort) {
  const origin = req?.headers?.origin;
  if (!origin) return true; // not a browser acting for another site
  let originHost;
  try { originHost = new URL(origin).host.toLowerCase(); } catch { return false; }
  const host = String(req?.headers?.host || '').toLowerCase();

  if (Number.isInteger(expectedPort) && expectedPort > 0 && expectedPort < 65536) {
    return esLoopbackConPuerto(originHost, expectedPort) && esLoopbackConPuerto(host, expectedPort);
  }

  // Sin puerto esperado: el comportamiento de antes, comparar entre sí.
  if (originHost === host) return true;
  // Same server reached by a different loopback spelling is still this server.
  return LOOPBACK.has(hostOf(originHost)) && LOOPBACK.has(hostOf(host));
}

/**
 * guard(req, res, methods) -> true when the request may proceed.
 *
 * Refusals are deliberately terse. A caller that should not be here learns
 * nothing about the machine, and a caller that should be here is our own code,
 * which already knows what it asked for.
 */
export function guard(req, res, methods, onRefused, expectedPort) {
  const method = String(req?.method || 'GET').toUpperCase();
  if (!methods.includes(method)) {
    res.writeHead(405, { 'content-type': 'application/json', allow: methods.join(', ') });
    res.end(JSON.stringify({ ok: false, reason: 'Method not allowed.' }));
    if (onRefused) onRefused(`${method} is not allowed here`);
    return false;
  }
  if (!isLoopback(req) || !isSameOrigin(req, expectedPort)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, reason: 'Refused.' }));
    // The origin is written down, never the path or the body: enough to tell a
    // stray page from a misconfigured companion, and nothing more.
    if (onRefused) onRefused(`origin ${req?.headers?.origin || '(none)'} on a non-local or cross-site request`);
    return false;
  }
  return true;
}

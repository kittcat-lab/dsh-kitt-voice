'use strict';
/**
 * Qué puede pedir la ventana flotante al arnés, y con qué dirección.
 *
 * La página de la ventana no toca la red: lo hace el proceso principal por
 * ella (ver main.js, «overlay:request»). Un fetch desde una página file://
 * viaja con «Origin: null», y el guardián del plugin lo rechaza a propósito —
 * medido con el propio guardián, no supuesto —, así que pedir desde la página
 * sería pedir un 403 fijo. Este módulo es la lista CERRADA de lo que la
 * ventana tiene derecho a pedir: una ventana que pudiera pedir cualquier cosa
 * sería una ventana que no hace falta que exista.
 */

/** La raíz del plugin, la misma de siempre. */
const BASE = '/dsh-kitt-voice';

/** Lo único que la ventana pide, método y ruta exactos. El estado sólo se
 *  LEE: lo publica la página, y una ventana que pudiera escribirlo podría
 *  contarle al resto lo que no está pasando. */
const PERMITIDAS = new Set([
  'GET /dsh-kitt-voice/config',
  'GET /dsh-kitt-voice/state',
  'GET /dsh-kitt-voice/devices',
  'GET /dsh-kitt-voice/voices',
  'POST /dsh-kitt-voice/command',
  'POST /dsh-kitt-voice/settings',
]);

/** ¿Puede la ventana pedir esto? Una ruta que no está aquí no llega a la red. */
function rutaPermitida(metodo, ruta) {
  return PERMITIDAS.has(`${String(metodo || 'GET').toUpperCase()} ${String(ruta || '')}`);
}

/**
 * La dirección completa, armada en el proceso principal a partir de un PUERTO,
 * nunca de una URL que le pasen: la ventana solo puede hablar con loopback.
 * Vacío cuando el puerto no es un puerto o la ruta no está bajo la raíz del
 * plugin (la lista de métodos se comprueba aparte, con el método delante).
 */
function urlDelArnes(port, ruta) {
  const puerto = Number.parseInt(port, 10);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) return '';
  const camino = String(ruta || '');
  if (camino !== BASE && !camino.startsWith(BASE + '/')) return '';
  return `http://127.0.0.1:${puerto}${camino}`;
}

module.exports = { BASE, PERMITIDAS, rutaPermitida, urlDelArnes };

/**
 * QUÉ PÁGINA MANDA.
 *
 * El arnés puede estar abierto en dos sitios a la vez: la aplicación instalada
 * y una pestaña del navegador, o dos pestañas. Las dos cargan este plugin, las
 * dos abren el flujo de órdenes y las dos publican su estado. Sin nadie que
 * reparta, una tecla del volante llegaba a las dos: dos micrófonos abiertos,
 * dos transcripciones, dos envíos — y la ventana flotante pintaba el estado de
 * una y de otra a saltos. «Nacen dos», «afecta a dos a la vez», «se mezcla».
 * Medido en uso, no en el código.
 *
 * Aquí se decide, con tres reglas y en este orden:
 *
 *   1. manda la página que está USANDO la voz: la que ha dicho «escuchando»,
 *      «pensando», «hablando» o tiene la conversación encendida;
 *   2. si ninguna la usa, manda la que la persona tiene delante: la última que
 *      recibió el foco, o la última que se conectó;
 *   3. una página que manda y desaparece —se cierra la pestaña— deja de mandar
 *      cuando lleva un rato sin flujo abierto y sin dar señales.
 *
 * Las páginas se presentan con un nombre que se inventan al cargar. Una página
 * de una versión anterior no trae nombre; a ésa se la trata como antes, para
 * no romperle nada a quien no ha actualizado la pestaña.
 *
 * Puro: ni red ni reloj propios. El reloj entra por parámetro para poder
 * probar «un rato después» sin esperar un rato.
 */

/** Cuánto aguanta el mando una página que ya no tiene flujo ni da señales. */
export const LIDER_CADUCA_MS = 15000;

/** Un estado en el que la voz está en uso. El error no cuenta: es un
 *  tropiezo, no una actividad. La conversación encendida cuenta siempre,
 *  aunque ahora mismo esté en reposo entre turno y turno. */
export function enUso(estado) {
  if (!estado) return false;
  const modo = String(estado.mode || 'idle');
  return Boolean(estado.conversation) || (modo !== 'idle' && modo !== 'error');
}

/**
 * ¿Es este cambio de estado el ARRANQUE de la voz —de parada a en uso—?
 *
 * Es la única transición que debe abrir la ventana flotante sola. Se abría en
 * CADA estado activo, y eso convertía el aspa en un botón inútil: cerrabas la
 * ventana a mitad de conversación y el siguiente cambio de estado, medio
 * segundo después, la volvía a abrir. «Le doy al aspa y no se cierra.»
 */
export function esArranque(antes, ahora) {
  return enUso(ahora) && !enUso(antes);
}

export function createPaginas() {
  const flujos = new Map();   // página -> flujos de órdenes abiertos ahora
  const orden = [];           // orden de conexión; la más reciente, al final
  let lider = '';
  let liderEnUso = false;
  let liderVisto = 0;         // última vez que la que manda dio señales

  const conectada = (page) => (flujos.get(page) || 0) > 0;
  const caducada = (ahora) => Boolean(lider) && !conectada(lider) && ahora - liderVisto > LIDER_CADUCA_MS;
  const ultimaConectada = () => {
    for (let i = orden.length - 1; i >= 0; i -= 1) if (conectada(orden[i])) return orden[i];
    return '';
  };
  const nombrar = (page, activa, ahora) => {
    lider = page;
    liderEnUso = activa;
    liderVisto = ahora;
  };

  return {
    /** Una página abre su flujo de órdenes. */
    conectar(page, ahora = Date.now()) {
      if (!page) return;
      flujos.set(page, (flujos.get(page) || 0) + 1);
      const i = orden.indexOf(page);
      if (i >= 0) orden.splice(i, 1);
      orden.push(page);
      if (page === lider) { liderVisto = ahora; return; }
      // Una página nueva manda si nadie está usando la voz, o si la que
      // mandaba ya no está.
      if (!lider || !liderEnUso || caducada(ahora)) nombrar(page, false, ahora);
    },

    /** Su flujo se cierra. No pierde el mando por eso: un flujo que se
     *  reconecta no es una página que se ha ido. */
    desconectar(page) {
      if (!page) return;
      const n = (flujos.get(page) || 0) - 1;
      if (n <= 0) flujos.delete(page); else flujos.set(page, n);
    },

    /**
     * Una página cuenta lo que hace. Devuelve si ese estado debe tomarse como
     * el estado vivo: el de la que manda, o el de una que ha empezado a usar
     * la voz (y que por eso pasa a mandar). Una página parada que no manda no
     * pisa el estado de la que sí.
     */
    estado(page, estadoNuevo, ahora = Date.now()) {
      if (!page) return true;   // una página sin nombre: como antes
      if (enUso(estadoNuevo)) { nombrar(page, true, ahora); return true; }
      if (page === lider) { liderEnUso = false; liderVisto = ahora; return true; }
      if (!lider || caducada(ahora)) { nombrar(page, false, ahora); return true; }
      return false;
    },

    /** La persona ha venido a esta página. Si nadie está usando la voz, las
     *  teclas pasan a ser suyas. */
    foco(page, ahora = Date.now()) {
      if (!page) return;
      if (page === lider) { liderVisto = ahora; return; }
      if (!lider || !liderEnUso || caducada(ahora)) nombrar(page, false, ahora);
    },

    /** A qué página va una orden. Vacío cuando no hay ninguna con nombre, y
     *  entonces la orden va a todas, como antes. */
    destinataria(ahora = Date.now()) {
      if (lider && conectada(lider)) return lider;
      if (lider && !caducada(ahora)) return lider;   // sin flujo pero viva: sondea
      const otra = ultimaConectada();
      if (otra) { nombrar(otra, false, ahora); return otra; }
      return lider;
    },

    get lider() { return lider; },
    get liderEnUso() { return liderEnUso; },
  };
}

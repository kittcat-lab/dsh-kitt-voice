/**
 * CUÁNDO ALGUIEN ESTÁ PIDIENDO LA PALABRA.
 *
 * Mientras el plugin lee una respuesta, el micrófono sigue abierto para que se
 * le pueda cortar hablando. El problema es obvio: por ese micrófono entra
 * también la propia respuesta saliendo del altavoz. Hay que distinguir una
 * cosa de la otra, y hay que hacerlo sin preguntarle nada a nadie.
 *
 * NO SE ADIVINA UN UMBRAL, SE MIDE.
 *
 * Un número fijo escrito aquí sería una apuesta sobre el equipo de otra
 * persona: su volumen, su micrófono, si lleva auriculares o los altavoces a
 * tope. Apostar mal en un sentido es cortarse solo cada dos frases; en el otro,
 * no poder cortar nunca.
 *
 * Así que durante el primer medio segundo de cada lectura se escucha lo que
 * entra, y eso ES el eco, por definición: todavía no ha hablado nadie. Ese es
 * el suelo de esta máquina, en esta habitación, a este volumen. Para tomar algo
 * por una voz hay que pasar ese suelo con holgura y además sostenerlo.
 *
 * Se recalibra en CADA lectura. El volumen cambia, los auriculares se ponen y
 * se quitan, y una medida de hace media hora es peor que ninguna.
 *
 * Vive en su propio fichero porque es la única parte de todo esto que se puede
 * comprobar sin un micrófono y una habitación: son números y decisiones.
 */

/** Cuánto se escucha antes de dar por buena ninguna voz. */
export const CALIBRAR_MS = 550;

/** Cuánto hay que pasar el suelo. El eco sube y baja; rozarlo es cortarse solo. */
export const HOLGURA = 3.2;

/**
 * Y un mínimo absoluto, pase lo que pase con el suelo.
 *
 * Con auriculares el suelo medido es casi cero, y sin esto cualquier crujido de
 * la silla lo multiplicaría por diez y contaría como voz.
 */
export const MINIMO_ABSOLUTO = 0.02;

/**
 * Cuánto hay que sostenerlo.
 *
 * Una puerta, una tos o un golpe en la mesa duran menos que esto. Alguien
 * pidiendo la palabra, más. Es la diferencia entre un detector y un susto.
 */
export const SOSTENER_MS = 320;

/** El estado limpio con el que empieza cada lectura. */
export function nuevoCorte(ahora) {
  return { desde: ahora, suelo: 0, vozDesde: 0 };
}

/**
 * Se le da un trozo de audio ya medido y dice qué hacer.
 *
 * Devuelve `'calibrando'` mientras aprende el eco, `'nada'` cuando lo que entra
 * no llega al listón o no se ha sostenido bastante, y `'cortar'` cuando hay
 * alguien hablando por encima.
 *
 * MUTA el estado que se le pasa, a propósito: se llama una vez por cada trozo
 * de audio —decenas por segundo— y crear un objeto nuevo cada vez para tirarlo
 * acto seguido es basura que alguien tendrá que recoger mientras se graba.
 */
export function mirarCorte(estado, energia, ahora) {
  const transcurrido = ahora - estado.desde;

  if (transcurrido < CALIBRAR_MS) {
    // Todavía no ha hablado nadie: lo que entra es el eco. Nos quedamos con lo
    // más fuerte, que es lo que habrá que superar.
    if (energia > estado.suelo) estado.suelo = energia;
    return 'calibrando';
  }

  const listón = Math.max(estado.suelo * HOLGURA, MINIMO_ABSOLUTO);

  if (energia <= listón) {
    // Se rompió la racha: era un ruido, no una voz.
    estado.vozDesde = 0;
    return 'nada';
  }

  if (!estado.vozDesde) { estado.vozDesde = ahora; return 'nada'; }
  if (ahora - estado.vozDesde < SOSTENER_MS) return 'nada';

  estado.vozDesde = 0;
  return 'cortar';
}

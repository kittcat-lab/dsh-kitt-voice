/**
 * Cuándo se corta al plugin y cuándo no.
 *
 * Estas pruebas existen porque esto es lo único de todo el asunto que se puede
 * comprobar sin un micrófono, una habitación y una persona hablando. Los
 * números —medio segundo calibrando, el triple del suelo, un tercio de segundo
 * sosteniendo— no se pueden mirar y decir «están bien»: hay que darles casos.
 *
 * Los dos fallos que se vigilan son los que arruinan la función:
 *   · cortarse solo, oyéndose a sí mismo (aquí: «el eco no corta»);
 *   · no cortarse nunca por mucho que le hables.
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  nuevoCorte, mirarCorte,
  CALIBRAR_MS, HOLGURA, MINIMO_ABSOLUTO, SOSTENER_MS,
} from '../lib/corte.js';

/** Le da de comer trozos de audio y devuelve lo que dijo en cada uno. */
function correr(estado, tramos) {
  const dichos = [];
  let t = estado.desde;
  for (const { energia, ms } of tramos) {
    const hasta = t + ms;
    while (t < hasta) { dichos.push(mirarCorte(estado, energia, t)); t += 32; }
  }
  return dichos;
}

test('mientras calibra no corta, diga lo que diga', () => {
  const e = nuevoCorte(0);
  const dichos = correr(e, [{ energia: 0.9, ms: CALIBRAR_MS - 40 }]);
  assert.ok(dichos.every((d) => d === 'calibrando'), 'no debería decidir nada aún');
  assert.ok(!dichos.includes('cortar'));
});

test('aprende el eco: se queda con lo más fuerte que oyó', () => {
  const e = nuevoCorte(0);
  correr(e, [
    { energia: 0.02, ms: 150 },
    { energia: 0.11, ms: 150 },   // el pico
    { energia: 0.04, ms: 200 },
  ]);
  assert.ok(Math.abs(e.suelo - 0.11) < 1e-9, `suelo aprendido: ${e.suelo}`);
});

test('EL ECO NO CORTA: lo mismo que se midió calibrando no basta después', () => {
  const e = nuevoCorte(0);
  // El eco sigue igual de fuerte durante toda la lectura, que es lo normal.
  const dichos = correr(e, [
    { energia: 0.08, ms: CALIBRAR_MS + 40 },
    { energia: 0.08, ms: 4000 },
  ]);
  assert.ok(!dichos.includes('cortar'), 'se estaría cortando a sí mismo');
});

test('ni aunque el eco suba un poco: para eso está la holgura', () => {
  const e = nuevoCorte(0);
  const dichos = correr(e, [
    { energia: 0.08, ms: CALIBRAR_MS + 40 },
    { energia: 0.08 * (HOLGURA - 0.6), ms: 3000 },
  ]);
  assert.ok(!dichos.includes('cortar'));
});

test('una voz por encima del suelo, sostenida, SÍ corta', () => {
  const e = nuevoCorte(0);
  const dichos = correr(e, [
    { energia: 0.05, ms: CALIBRAR_MS + 40 },
    { energia: 0.05 * HOLGURA * 2, ms: SOSTENER_MS + 200 },
  ]);
  assert.ok(dichos.includes('cortar'), 'debería haber cortado');
});

test('pero no antes de tiempo: hay que sostenerlo', () => {
  const e = nuevoCorte(0);
  const dichos = correr(e, [
    { energia: 0.05, ms: CALIBRAR_MS + 40 },
    { energia: 0.05 * HOLGURA * 2, ms: SOSTENER_MS - 120 },
  ]);
  assert.ok(!dichos.includes('cortar'), 'ha cortado demasiado pronto');
});

test('un golpe seco no corta, por fuerte que sea', () => {
  const e = nuevoCorte(0);
  const dichos = correr(e, [
    { energia: 0.05, ms: CALIBRAR_MS + 40 },
    { energia: 0.9, ms: 90 },      // la puerta
    { energia: 0.05, ms: 900 },    // y otra vez el eco de siempre
  ]);
  assert.ok(!dichos.includes('cortar'), 'un portazo no es pedir la palabra');
});

test('dos golpes seguidos tampoco: la racha se rompe entre medias', () => {
  const e = nuevoCorte(0);
  const dichos = correr(e, [
    { energia: 0.05, ms: CALIBRAR_MS + 40 },
    { energia: 0.9, ms: 120 },
    { energia: 0.05, ms: 200 },
    { energia: 0.9, ms: 120 },
    { energia: 0.05, ms: 200 },
  ]);
  assert.ok(!dichos.includes('cortar'));
});

test('con auriculares —suelo casi cero— sigue haciendo falta un mínimo', () => {
  // Aquí está el motivo del mínimo absoluto: sin él, con el suelo a 0,0005
  // cualquier crujido de la silla lo multiplica por veinte y cuenta como voz.
  const e = nuevoCorte(0);
  const dichos = correr(e, [
    { energia: 0.0005, ms: CALIBRAR_MS + 40 },
    { energia: MINIMO_ABSOLUTO * 0.7, ms: 2000 },   // muy por encima del suelo…
  ]);
  assert.ok(!dichos.includes('cortar'), '…pero por debajo del mínimo: no corta');
});

test('y con auriculares una voz de verdad sí corta', () => {
  const e = nuevoCorte(0);
  const dichos = correr(e, [
    { energia: 0.0005, ms: CALIBRAR_MS + 40 },
    { energia: MINIMO_ABSOLUTO * 3, ms: SOSTENER_MS + 200 },
  ]);
  assert.ok(dichos.includes('cortar'));
});

test('cada lectura recalibra: el volumen de antes no manda en la de ahora', () => {
  const a = nuevoCorte(0);
  correr(a, [{ energia: 0.30, ms: CALIBRAR_MS + 40 }]);   // altavoces a tope
  const b = nuevoCorte(0);
  correr(b, [{ energia: 0.01, ms: CALIBRAR_MS + 40 }]);   // ahora, auriculares
  assert.ok(b.suelo < a.suelo / 10, 'la segunda lectura arrastra la primera');
});

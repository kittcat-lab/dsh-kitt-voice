import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRate, RATE_MIN, RATE_MAX } from '../lib/index.js';

/**
 * La velocidad de lectura, acotada.
 *
 * Dos cosas que salen caras si se hacen mal, y por eso están aquí:
 *
 *   - un ritmo sin límite se lo puede pedir cualquiera que alcance la ruta,
 *     y la máquina se pone a recitar a una velocidad que no se puede parar
 *     leyendo;
 *   - un valor que no es un número tiene que caer en el ritmo natural, no en
 *     el mínimo: una voz que de pronto habla lentísima parece rota, y nadie
 *     relaciona eso con un ajuste que se guardó mal.
 */

test('un número razonable que se pasa de los límites se recorta', () => {
  assert.equal(safeRate(50), RATE_MAX);
  assert.equal(safeRate(0.01), RATE_MIN);
});

test('una chorrada cae en el ritmo natural, NUNCA en el mínimo', () => {
  // Esta prueba cazó un fallo de verdad: un ajuste vacío se convierte en cero,
  // el cero es finito, y se recortaba al mínimo — o sea, la voz hablando
  // lentísima de repente, que suena a avería y no a ajuste mal guardado.
  assert.equal(safeRate(null), 1, 'un ajuste vacío no puede salir «muy lento»');
  assert.equal(safeRate(''), 1);
  assert.equal(safeRate(0), 1);
  assert.equal(safeRate(-3), 1, 'un ritmo negativo es un error, no «lo más lento»');
  assert.equal(safeRate('hola'), 1);
  assert.equal(safeRate(undefined), 1);
  assert.equal(safeRate(NaN), 1);
  assert.equal(safeRate(Infinity), 1);
  assert.equal(safeRate({}), 1);
});

test('los ritmos que ofrece el menú pasan tal cual', () => {
  for (const r of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    assert.equal(safeRate(r), r, `${r} debería pasar sin tocarse`);
  }
  // Y el número escrito como texto, que es como llega de una lista desplegable.
  assert.equal(safeRate('1.25'), 1.25);
});

test('los límites son los que dicen ser', () => {
  assert.ok(RATE_MIN > 0, 'un ritmo de cero o negativo no es un ritmo');
  assert.ok(RATE_MAX >= 2, 'pedido de la casa: tiene que llegar al doble');
});

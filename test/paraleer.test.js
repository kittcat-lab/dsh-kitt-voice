import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lo que NO se pronuncia.
 *
 * Igual que el troceador de frases, esto vive dentro de la mitad de navegador,
 * que se sirve como un solo fichero y no se puede importar. Así que la función
 * se saca por su nombre del fichero que de verdad se envía: una copia pegada
 * aquí sólo probaría la copia.
 *
 * Y hay una razón de peso para que esta prueba exista: la limpieza ESTABA
 * escrita en `chunk.js` y no la llamaba nadie del camino vivo, así que el
 * plugin llevaba leyendo los asteriscos en alto sin que ninguna prueba se
 * enterara. Ésta sujeta la función por donde se usa.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

const inicioTablas = source.indexOf('const SOLO_DIBUJO =');
assert.notEqual(inicioTablas, -1, 'SOLO_DIBUJO ya no está en lib/client.js');
const inicio = source.indexOf('function paraLeer(', inicioTablas);
assert.notEqual(inicio, -1, 'paraLeer ya no está en lib/client.js');
const fin = source.indexOf('\n    }', inicio) + '\n    }'.length;
const paraLeer = new Function(
  `${source.slice(inicioTablas, fin)}; return paraLeer;`
)();

test('la decoración de markdown no se pronuncia', () => {
  assert.equal(paraLeer('**Listo** y _claro_'), 'Listo y claro');
  assert.equal(paraLeer('## Título'), 'Título');
  assert.equal(paraLeer('usa `npm test` aquí'), 'usa npm test aquí');
});

test('un bloque de código se nombra, no se deletrea', () => {
  // Sin el salto: los saltos de línea ya no llegan a la voz, porque cada uno
  // era un silencio largo. Ver la prueba de los saltos, más abajo.
  assert.equal(paraLeer('Mira:\n```js\nconst a = 1;\n```'), 'Mira: bloque de código');
});

test('los emojis y los iconos no se leen', () => {
  assert.equal(paraLeer('Hecho ✅'), 'Hecho');
  assert.equal(paraLeer('😀 Hola 🎉 qué tal 🚀'), 'Hola qué tal');
  assert.equal(paraLeer('Bandera 🇪🇸 fuera'), 'Bandera fuera');
  // Ni el pegamento de los emojis compuestos deja restos.
  assert.equal(paraLeer('familia 👨‍👩‍👧 aquí'), 'familia aquí');
});

test('lo que significa algo se dice, no se borra', () => {
  assert.equal(paraLeer('A → B'), 'A a B');
  assert.equal(paraLeer('coste ✓ tiempo ✗'), 'coste sí tiempo no');
  assert.equal(paraLeer('Espera…'), 'Espera.');
});

test('una viñeta se convierte en la pausa que haría un lector', () => {
  assert.equal(paraLeer('Frena • gira • sal'), 'Frena, gira, sal');
});

test('los saltos de línea no se leen como silencios largos', () => {
  // Una lista se lee de corrido, con la pausa corta de una coma. Antes cada
  // salto llegaba a la voz y sonaba a que se había colgado entre punto y punto.
  assert.equal(paraLeer('• Uno\n• Dos'), 'Uno, Dos');
  assert.equal(paraLeer('Frena antes.\nGira más tarde.'), 'Frena antes. Gira más tarde.');
  // Una línea en blanco de separación no aporta nada al oído.
  assert.equal(paraLeer('Primero\n\n\nSegundo'), 'Primero, Segundo');
  // Y lo que ya terminaba en puntuación no se lleva una coma de más.
  assert.equal(paraLeer('¿Vale?\nSigo'), '¿Vale? Sigo');
});

test('la puntuación de verdad y los números no se tocan', () => {
  assert.equal(paraLeer('Son 54.5 grados, ¿vale?'), 'Son 54.5 grados, ¿vale?');
  assert.equal(paraLeer('Uno, dos; y tres.'), 'Uno, dos; y tres.');
});

test('un texto que sólo era iconos no deja restos que decir', () => {
  assert.equal(paraLeer('🎉🎉🎉'), '');
  assert.equal(paraLeer('   '), '');
  assert.equal(paraLeer(''), '');
  assert.equal(paraLeer(null), '');
});

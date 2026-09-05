import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * En qué trozos se le da el texto a la voz.
 *
 * Vive dentro de la mitad de navegador, que se sirve como un solo fichero, así
 * que se saca por su nombre del fichero que de verdad se envía — una copia
 * pegada aquí sólo probaría la copia.
 *
 * Existe por tres fallos que se vieron usándolo: la voz del sistema que se
 * callaba a mitad de un párrafo largo y dejaba la lectura colgada, el servidor
 * que recortaba a dos mil letras sin decirlo, y Piper que con una respuesta
 * larga se pasaba de tiempo y caía a la voz del sistema — con lo que la voz
 * «cambiaba sola». Los tres se curan no pidiendo nunca demasiado de una vez.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');
const start = source.indexOf('function trocear(');
assert.notEqual(start, -1, 'trocear ya no está en lib/client.js');
const end = source.indexOf('\n    }', start) + '\n    }'.length;
const trocear = new Function(`${source.slice(start, end)}; return trocear;`)();

test('un texto corto es un solo trozo', () => {
  assert.deepEqual(trocear('Frena antes. Gira más tarde.', 220), ['Frena antes. Gira más tarde.']);
});

test('nada que decir, nada que trocear', () => {
  assert.deepEqual(trocear('', 220), []);
  assert.deepEqual(trocear('   ', 220), []);
  assert.deepEqual(trocear(null, 220), []);
});

test('ningún trozo pasa del límite', () => {
  const largo = 'Una frase normal de las de siempre. '.repeat(60);
  for (const trozo of trocear(largo, 220)) assert.ok(trozo.length <= 220, `${trozo.length} letras`);
});

test('corta en finales de frase, no a media', () => {
  const trozos = trocear('Frena antes. Gira más tarde. Y sal apretando.', 30);
  assert.deepEqual(trozos, ['Frena antes. Gira más tarde.', 'Y sal apretando.']);
});

test('un decimal no es un final de frase', () => {
  assert.deepEqual(trocear('Ponlo en 54.5 y prueba. Luego 55.', 30), ['Ponlo en 54.5 y prueba.', 'Luego 55.']);
  // Y si hay que partir por espacios, el número sigue entero.
  assert.ok(trocear('Ponlo en 54.5 y prueba.', 12).some((t) => t.includes('54.5')));
});

test('una frase más larga que el límite se parte en comas, y luego en espacios', () => {
  const frase = 'primero el reglaje, después el ritmo, y al final la estrategia de la carrera entera';
  const trozos = trocear(frase, 40);
  assert.ok(trozos.length >= 2);
  for (const t of trozos) assert.ok(t.length <= 40, t);
  assert.equal(trozos.join(' '), frase);
});

test('una palabra imposible se parte por la fuerza antes que perderse', () => {
  const trozos = trocear('x'.repeat(100), 30);
  assert.equal(trozos.join(''), 'x'.repeat(100));
  for (const t of trozos) assert.ok(t.length <= 30);
});

test('no se pierde ni una palabra por el camino', () => {
  const texto = 'Uno. Dos y tres, cuatro; cinco. ¿Seis? Siete: ocho, nueve, diez. Once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte.';
  const junto = trocear(texto, 25).join(' ').replace(/\s+/g, ' ');
  assert.equal(junto, texto.replace(/\s+/g, ' '));
});

test('los saltos de línea también cierran un trozo', () => {
  assert.deepEqual(trocear('Primero esto\ny luego aquello', 220), ['Primero esto y luego aquello']);
  const trozos = trocear('Primero esto\ny luego aquello', 15);
  assert.deepEqual(trozos, ['Primero esto', 'y luego aquello']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The sentence splitter lives inside the browser half, which is served to the
 * page as one file and cannot be imported. So the function is lifted out of
 * that file by name and run here. It tests the code that actually ships —
 * copying it into this file would only ever test the copy.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');
const start = source.indexOf('function frasesEnteras(');
assert.notEqual(start, -1, 'frasesEnteras is no longer in lib/client.js');
const end = source.indexOf('\n    }', start) + '\n    }'.length;
const frasesEnteras = new Function(`${source.slice(start, end)}; return frasesEnteras;`)();

test('holds a sentence back until its ending arrives', () => {
  assert.deepEqual(frasesEnteras('El reglaje está'), ['', 'El reglaje está']);
  assert.deepEqual(frasesEnteras('El reglaje está listo.'), ['El reglaje está listo.', '']);
});

test('hands over every finished sentence at once, and keeps the tail', () => {
  const [ahora, resto] = frasesEnteras('Frena antes. Gira más tarde. Y sal apretan');
  assert.equal(ahora, 'Frena antes. Gira más tarde.');
  assert.equal(resto, ' Y sal apretan');
});

test('a decimal is not the end of a sentence', () => {
  // "brake bias 54.5" — cutting here would read «cincuenta y cuatro punto»
  // and then stop, which sounds like a fault.
  assert.deepEqual(frasesEnteras('Ponlo en 54.5 y'), ['', 'Ponlo en 54.5 y']);
});

test('question marks and line breaks also end a sentence', () => {
  assert.equal(frasesEnteras('¿Vas a entrar a boxes? Aún no')[0], '¿Vas a entrar a boxes?');
  assert.equal(frasesEnteras('Primero esto\ny luego')[0], 'Primero esto\n');
});

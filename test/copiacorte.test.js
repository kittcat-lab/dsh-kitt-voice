/**
 * Que las dos copias de la decisión de cortar digan lo mismo.
 *
 * Hay dos a propósito, y la razón es dura: `lib/client.js` se le sirve al
 * navegador como UN fichero suelto, sin empaquetador, y el cargador del arnés
 * lo carga como un bundle. Un `import` de un fichero hermano hace que ese
 * bundle se cargue «sin registrarse» y el arnés se queda en **Failed to load
 * plugins**, con el plugin entero fuera — no sólo esa función.
 *
 * Eso ya pasó: se sacó la lógica a `lib/corte.js` para poder probarla, se
 * importó desde el cliente, y el plugin dejó de cargar. Lo descubrió quien lo
 * estaba usando, no una prueba.
 *
 * Así que la lógica vive dentro del cliente, y `lib/corte.js` es la copia que
 * sí se puede probar sin un navegador. Duplicar es malo. Duplicar con una
 * prueba que salta cuando las dos se separan es lo único que funciona aquí.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALIBRAR_MS, HOLGURA, MINIMO_ABSOLUTO, SOSTENER_MS, nuevoCorte, mirarCorte } from '../lib/corte.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliente = fs.readFileSync(path.join(RAIZ, 'lib/client.js'), 'utf8');

test('el cliente NO importa nada: se sirve como un fichero suelto', () => {
  const imports = cliente.split('\n').filter((l) => /^\s*import[\s{]/.test(l));
  assert.deepStrictEqual(imports, [],
    'un import en client.js deja el arnés en «Failed to load plugins» — está en las trampas');
});

test('los cuatro números son los mismos en las dos copias', () => {
  for (const [nombre, valor] of [
    ['CALIBRAR_MS', CALIBRAR_MS], ['HOLGURA', HOLGURA],
    ['MINIMO_ABSOLUTO', MINIMO_ABSOLUTO], ['SOSTENER_MS', SOSTENER_MS],
  ]) {
    const m = cliente.match(new RegExp(`const ${nombre} = ([0-9.]+)`));
    assert.ok(m, `client.js no declara ${nombre}`);
    assert.strictEqual(Number(m[1]), valor,
      `${nombre}: el cliente dice ${m[1]} y lib/corte.js dice ${valor}`);
  }
});

test('y la copia del cliente decide igual que la probada', () => {
  // Se saca la función del cliente y se la hace pasar por los mismos casos.
  const i = cliente.indexOf('function mirarCorte(');
  assert.ok(i > 0, 'client.js no tiene mirarCorte');
  const trozo = cliente.slice(i);
  const fin = trozo.indexOf('\n        }') + '\n        }'.length;
  const fuente = trozo.slice(0, fin);

  const suyo = new Function(
    'CALIBRAR_MS', 'HOLGURA', 'MINIMO_ABSOLUTO', 'SOSTENER_MS',
    `${fuente}; return mirarCorte;`,
  )(CALIBRAR_MS, HOLGURA, MINIMO_ABSOLUTO, SOSTENER_MS);

  // Los casos que importan: el eco callado, la voz que corta, el portazo que no.
  const casos = [
    { nombre: 'el eco no corta', tramos: [[0.08, 900], [0.08, 3000]] },
    { nombre: 'una voz sí corta', tramos: [[0.05, 900], [0.05 * HOLGURA * 2, 800]] },
    { nombre: 'un portazo no', tramos: [[0.05, 900], [0.9, 90], [0.05, 900]] },
    { nombre: 'con cascos hace falta el mínimo', tramos: [[0.0005, 900], [MINIMO_ABSOLUTO * 0.7, 2000]] },
  ];

  for (const { nombre, tramos } of casos) {
    const a = nuevoCorte(0);
    const b = { desde: 0, suelo: 0, vozDesde: 0 };
    let t = 0;
    for (const [energia, ms] of tramos) {
      const hasta = t + ms;
      while (t < hasta) {
        assert.strictEqual(suyo(b, energia, t), mirarCorte(a, energia, t),
          `«${nombre}»: las dos copias no dicen lo mismo en t=${t}`);
        t += 32;
      }
    }
  }
});

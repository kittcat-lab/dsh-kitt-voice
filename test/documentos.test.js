/**
 * Los documentos publicados, comprobados por una máquina.
 *
 * Están aquí y no en una lista de tareas porque los dos fallos que cubren se
 * publicaron de verdad, y ninguno de los dos dio un error: un texto en chino
 * que se codificó dos veces al reescribir el fichero con la herramienta
 * equivocada, y un enlace que apuntaba a un archivo que no viaja dentro del
 * paquete. Los dos se leen perfectamente en el editor de quien los escribió.
 *
 * Una comprobación que puede ser código no debería ser un par de ojos.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');

const DOCUMENTOS = [
  'README.md', 'README.es.md', 'README.zh.md',
  'CHANGELOG.md', 'CONTRIBUTING.md', 'NOTICE',
  'DOCUMENTACION/TRAPS.md', 'DOCUMENTACION/TRAPS.es.md', 'DOCUMENTACION/TRAPS.zh.md',
];

/**
 * La firma de un texto UTF-8 leído como si fuera de un solo byte y vuelto a
 * guardar como UTF-8: las tildes se parten en dos y los ideogramas en tres.
 * «Ã³» donde había una ó; «å…³» donde había 关.
 */
const DOBLE = /Ã[-¿]|Â[-¿]|â€[]|[åæèç][-¿]{2}/;

/** El «MicrÃ³fono» del documento de trampas es el EJEMPLO, no un fallo. */
const A_PROPOSITO = /MicrÃ³fono|å…³äºŽ/;

test('ningún documento publicado está codificado dos veces', () => {
  for (const doc of DOCUMENTOS) {
    const p = path.join(RAIZ, doc);
    if (!fs.existsSync(p)) continue;
    const malas = fs.readFileSync(p, 'utf8').split('\n')
      .map((linea, i) => (DOBLE.test(linea) && !A_PROPOSITO.test(linea) ? i + 1 : 0))
      .filter(Boolean);
    assert.deepStrictEqual(malas, [], `${doc}: líneas codificadas dos veces: ${malas.join(', ')}`);
  }
});

test('todo enlace relativo de un documento lleva a algo que existe', () => {
  const rotos = [];
  for (const doc of DOCUMENTOS) {
    const p = path.join(RAIZ, doc);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const destino = m[1];
      if (/^(https?:|mailto:|#)/.test(destino)) continue;
      const limpio = destino.split('#')[0];
      if (!limpio) continue;
      if (!fs.existsSync(path.resolve(path.dirname(p), limpio))) rotos.push(`${doc} -> ${destino}`);
    }
  }
  assert.deepStrictEqual(rotos, [], `enlaces rotos:\n  ${rotos.join('\n  ')}`);
});

test('los tres idiomas del documento de trampas se enlazan entre sí', () => {
  const idiomas = ['TRAPS.md', 'TRAPS.es.md', 'TRAPS.zh.md'];
  for (const uno of idiomas) {
    const t = fs.readFileSync(path.join(RAIZ, 'DOCUMENTACION', uno), 'utf8');
    for (const otro of idiomas.filter((x) => x !== uno)) {
      assert.ok(t.includes(`(${otro})`), `${uno} no enlaza a ${otro}`);
    }
  }
});

test('el aviso de pnpm está en los tres README, no sólo en el inglés', () => {
  // El fallo real: la nota se escribió en los tres, pero la china quedó
  // ilegible. Se comprueba que la instrucción que arregla el problema —el
  // «false»— aparece, porque eso es lo único que de verdad tiene que llegar.
  for (const doc of ['README.md', 'README.es.md', 'README.zh.md']) {
    const t = fs.readFileSync(path.join(RAIZ, doc), 'utf8');
    assert.ok(t.includes('ERR_PNPM_IGNORED_BUILDS'), `${doc} no nombra el error de pnpm`);
    assert.ok(t.includes('msedge-tts: false'), `${doc} no dice cuál es el arreglo`);
  }
});

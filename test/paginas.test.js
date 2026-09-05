/**
 * Qué página manda cuando hay dos.
 *
 * El fallo que cubren se vio usándolo: el arnés abierto en la aplicación y en
 * una pestaña, y una tecla del volante abría dos micrófonos. Las reglas son
 * pocas y hay que darles casos, porque «la que está usando la voz» y «la que
 * tiene delante» se pisan entre sí en cuanto hay dos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaginas, enUso, esArranque, LIDER_CADUCA_MS } from '../lib/paginas.js';

const activo = (mode) => ({ mode, conversation: false });
const charla = (mode) => ({ mode, conversation: true });

test('con una sola página, manda ella', () => {
  const p = createPaginas();
  p.conectar('A', 1000);
  assert.equal(p.destinataria(1000), 'A');
  assert.equal(p.estado('A', activo('listening'), 1100), true);
  assert.equal(p.destinataria(1200), 'A');
});

test('una página nueva manda sólo si nadie está usando la voz', () => {
  const p = createPaginas();
  p.conectar('A', 1000);
  p.conectar('B', 2000);
  assert.equal(p.destinataria(2000), 'B', 'A estaba parada: la nueva manda');

  const q = createPaginas();
  q.conectar('A', 1000);
  q.estado('A', charla('armed'), 1500);
  q.conectar('B', 2000);
  assert.equal(q.destinataria(2000), 'A', 'A tiene la conversación encendida: sigue mandando');
});

test('la que empieza a usar la voz pasa a mandar, y la parada no le pisa el estado', () => {
  const p = createPaginas();
  p.conectar('A', 1000);
  p.conectar('B', 1000);
  assert.equal(p.estado('A', activo('listening'), 2000), true);
  assert.equal(p.destinataria(2000), 'A');
  // B, parada, publica su reposo: no se acepta como el estado vivo.
  assert.equal(p.estado('B', activo('idle'), 2100), false);
  // A vuelve al reposo: se acepta, y sigue mandando.
  assert.equal(p.estado('A', activo('idle'), 2200), true);
  assert.equal(p.destinataria(2300), 'A');
});

test('el foco cambia el mando sólo cuando nadie usa la voz', () => {
  const p = createPaginas();
  p.conectar('A', 1000);
  p.conectar('B', 1000);
  p.estado('A', charla('thinking'), 1500);
  p.foco('B', 1600);
  assert.equal(p.destinataria(1600), 'A', 'A está en plena conversación');
  p.estado('A', activo('idle'), 1700);
  p.foco('B', 1800);
  assert.equal(p.destinataria(1800), 'B', 'ya nadie usa la voz: la de delante manda');
});

test('la que manda no pierde el mando por reconectar su flujo', () => {
  const p = createPaginas();
  p.conectar('A', 1000);
  p.conectar('B', 1000);
  p.estado('A', charla('armed'), 1500);
  p.desconectar('A');
  // Sin flujo pero acaba de dar señales: sigue siendo suya.
  assert.equal(p.destinataria(1600), 'A');
  p.conectar('A', 1700);
  assert.equal(p.destinataria(1700), 'A');
});

test('una página que se cierra deja de mandar pasado un rato', () => {
  const p = createPaginas();
  p.conectar('A', 1000);
  p.conectar('B', 1000);
  p.estado('A', charla('armed'), 1500);
  p.desconectar('A');
  const despues = 1500 + LIDER_CADUCA_MS + 1;
  assert.equal(p.destinataria(despues), 'B');
  // Y B ya puede publicar su estado.
  assert.equal(p.estado('B', activo('idle'), despues + 1), true);
});

test('una página sin nombre (versión anterior) se acepta y no toca el mando', () => {
  const p = createPaginas();
  p.conectar('A', 1000);
  assert.equal(p.estado('', activo('listening'), 1100), true);
  assert.equal(p.destinataria(1200), 'A');
  p.conectar('', 1300);
  p.foco('', 1300);
  assert.equal(p.destinataria(1300), 'A');
});

test('sin ninguna página con nombre, la orden va a todas', () => {
  const p = createPaginas();
  assert.equal(p.destinataria(1000), '');
});

test('enUso: la conversación encendida cuenta aunque esté en reposo; el error no', () => {
  assert.equal(enUso({ mode: 'idle' }), false);
  assert.equal(enUso({ mode: 'error' }), false);
  assert.equal(enUso({ mode: 'listening' }), true);
  assert.equal(enUso({ mode: 'armed', conversation: true }), true);
  assert.equal(enUso({ mode: 'error', conversation: true }), true);
  assert.equal(enUso(null), false);
});

test('la ventana se abre sola SÓLO al arrancar la voz, no en cada estado', () => {
  assert.equal(esArranque({ mode: 'idle' }, { mode: 'listening' }), true);
  assert.equal(esArranque({ mode: 'listening' }, { mode: 'transcribing' }), false);
  // Dentro de una conversación, ningún cambio es un arranque: cerrar la
  // ventana a mitad tiene que respetarse.
  assert.equal(esArranque(charla('reading'), charla('armed')), false);
  assert.equal(esArranque(charla('armed'), charla('listening')), false);
  // Un error de dictado y volver a pulsar sí es un arranque nuevo.
  assert.equal(esArranque({ mode: 'error' }, { mode: 'listening' }), true);
  assert.equal(esArranque({ mode: 'idle' }, { mode: 'error' }), false);
});

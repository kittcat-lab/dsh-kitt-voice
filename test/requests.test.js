/**
 * La lista cerrada de lo que la ventana flotante puede pedir al arnés.
 * Es el puente de privilegios: una ruta que no esté aquí no llega a la red.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rutaPermitida, urlDelArnes } = require('../overlay/requests.js');

test('las rutas que la ventana usa de verdad están permitidas', () => {
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/state'), true);
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/config'), true);
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/devices'), true);
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/voices'), true);
  assert.equal(rutaPermitida('POST', '/dsh-kitt-voice/command'), true);
  assert.equal(rutaPermitida('POST', '/dsh-kitt-voice/settings'), true);
});

test('una ruta que no está en la lista no llega a la red', () => {
  // Cosas que la ventana no necesita pedir, aunque el plugin las sirva.
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/transcribe'), false);
  assert.equal(rutaPermitida('POST', '/dsh-kitt-voice/transcribe'), false);
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/speak'), false);
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/last'), false);
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/vad/file/bundle.min.js'), false);
  assert.equal(rutaPermitida('POST', '/dsh-kitt-voice/vad/download'), false);
  assert.equal(rutaPermitida('GET', '/'), false);
  assert.equal(rutaPermitida('GET', ''), false);
  // Método equivocado para una ruta que sí existe.
  assert.equal(rutaPermitida('DELETE', '/dsh-kitt-voice/state'), false);
  assert.equal(rutaPermitida('POST', '/dsh-kitt-voice/voices'), false);
  // El estado sólo se lee: escribirlo es de la página, no de la ventana.
  assert.equal(rutaPermitida('POST', '/dsh-kitt-voice/state'), false);
  // Prefijos que parecen la ruta pero no lo son.
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice/state/extra'), false);
  assert.equal(rutaPermitida('GET', '/dsh-kitt-voice-states'), false);
});

test('la dirección se arma desde un puerto y nunca acepta otro host', () => {
  assert.equal(urlDelArnes('3090', '/dsh-kitt-voice/state'), 'http://127.0.0.1:3090/dsh-kitt-voice/state');
  assert.equal(urlDelArnes('', '/dsh-kitt-voice/state'), '');
  assert.equal(urlDelArnes('99999', '/dsh-kitt-voice/state'), '');
  assert.equal(urlDelArnes('0', '/dsh-kitt-voice/state'), '');
  // Una URL que le pasen no se convierte en la dirección: solo rutas del plugin.
  assert.equal(urlDelArnes('3090', 'http://evil.example/state'), '');
  assert.equal(urlDelArnes('3090', '/dsh-kitt-voice-states'), '');
  assert.equal(urlDelArnes('3090', ''), '');
});

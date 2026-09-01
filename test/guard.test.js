/**
 * The guard decides who may open a microphone on this machine, so it is the
 * one piece worth testing line by line. Everything here is a request shape the
 * plugin can actually receive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isLoopback, isSameOrigin, guard } from '../lib/guard.js';

const req = (over = {}) => ({
  method: 'GET',
  socket: { remoteAddress: '127.0.0.1' },
  headers: { host: '127.0.0.1:3081' },
  ...over,
});

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body || ''; },
  };
}

test('loopback is recognised however it is spelled', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopback(req({ socket: { remoteAddress: address } })), true, address);
  }
});

test('a request from another machine is not loopback', () => {
  const outside = req({ socket: { remoteAddress: '192.168.1.40' }, headers: { host: '192.168.1.9:3081' } });
  assert.equal(isLoopback(outside), false);
});

test('a direct call with no origin is allowed', () => {
  // The companion window, curl and health checks send no Origin. Only browsers
  // do, and only when acting on behalf of a page.
  assert.equal(isSameOrigin(req()), true);
});

test('a page on another site is refused', () => {
  const fromElsewhere = req({ headers: { host: '127.0.0.1:3081', origin: 'https://example.com' } });
  assert.equal(isSameOrigin(fromElsewhere), false);
});

test('the harness page itself is allowed', () => {
  const own = req({ headers: { host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081' } });
  assert.equal(isSameOrigin(own), true);
});

test('localhost and 127.0.0.1 are the same server', () => {
  const mixed = req({ headers: { host: '127.0.0.1:3081', origin: 'http://localhost:3081' } });
  assert.equal(isSameOrigin(mixed), true);
});

test('a malformed origin is refused rather than guessed', () => {
  assert.equal(isSameOrigin(req({ headers: { host: '127.0.0.1:3081', origin: 'not a url' } })), false);
});

test('the wrong method is refused and says which ones are allowed', () => {
  const res = fakeResponse();
  assert.equal(guard(req({ method: 'GET' }), res, ['POST']), false);
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('a refusal tells the caller nothing about the machine', () => {
  const res = fakeResponse();
  const outside = req({ method: 'POST', socket: { remoteAddress: '10.0.0.5' }, headers: { host: '10.0.0.5:3081' } });
  assert.equal(guard(outside, res, ['POST']), false);
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).reason, 'Refused.');
});

test('a normal request from the harness passes', () => {
  const res = fakeResponse();
  const own = req({ method: 'POST', headers: { host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081' } });
  assert.equal(guard(own, res, ['GET', 'POST']), true);
  assert.equal(res.status, 0, 'a request that passes must not be answered by the guard');
});

test('a refusal is reported to the caller-supplied logger, once per request', () => {
  const said = [];
  const res = fakeResponse();
  const outside = req({ method: 'POST', headers: { host: '127.0.0.1:3081', origin: 'https://example.com' } });
  guard(outside, res, ['POST'], (reason) => said.push(reason));
  assert.equal(said.length, 1);
  assert.match(said[0], /example\.com/);
});

test('what is written down never includes the request body or path', () => {
  const said = [];
  const res = fakeResponse();
  const outside = req({
    method: 'POST',
    url: '/dsh-kitt-voice/transcribe?prompt=secret-vocabulary',
    headers: { host: '127.0.0.1:3081', origin: 'https://example.com' },
  });
  guard(outside, res, ['POST'], (reason) => said.push(reason));
  assert.doesNotMatch(said[0], /transcribe|secret-vocabulary/);
});

test('a request that passes writes nothing down', () => {
  const said = [];
  guard(req({ method: 'GET' }), fakeResponse(), ['GET'], (reason) => said.push(reason));
  assert.equal(said.length, 0);
});

test('la cabecera Host no puede hacerse pasar por local', () => {
  // La escribe quien llama. Medido antes de arreglarlo: una petición desde
  // 192.168.1.40 con «Host: 127.0.0.1» pasaba el guardián entero, y con el
  // puerto alcanzable desde la red eso es cualquiera transcribiendo o leyendo
  // la última respuesta.
  const deFuera = (host) => ({ socket: { remoteAddress: '192.168.1.40' }, headers: { host } });
  assert.equal(isLoopback(deFuera('127.0.0.1')), false);
  assert.equal(isLoopback(deFuera('localhost')), false);
  assert.equal(isLoopback(deFuera('[::1]')), false);

  // Y lo de siempre sigue valiendo.
  assert.equal(isLoopback({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::1' }, headers: {} }), true);
  // Sin dirección no queda más remedio que creerle a la cabecera.
  assert.equal(isLoopback({ headers: { host: '127.0.0.1:3090' } }), true);
});

test('el puerto esperado ata el origen y el Host a este mismo servidor', () => {
  const propia = req({ headers: { host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081' } });
  assert.equal(isSameOrigin(propia, 3081), true);
  const porLocalhost = req({ headers: { host: 'localhost:3081', origin: 'http://localhost:3081' } });
  assert.equal(isSameOrigin(porLocalhost, 3081), true);
  const grafiaCruzada = req({ headers: { host: '127.0.0.1:3081', origin: 'http://localhost:3081' } });
  assert.equal(isSameOrigin(grafiaCruzada, 3081), true);
});

test('una página de OTRO puerto del loopback ya no pasa por este servidor', () => {
  const otroPuerto = req({ headers: { host: '127.0.0.1:3081', origin: 'http://127.0.0.1:5555' } });
  assert.equal(isSameOrigin(otroPuerto, 3081), false);
  const otroPuertoEnHost = req({ headers: { host: '127.0.0.1:5555', origin: 'http://127.0.0.1:3081' } });
  assert.equal(isSameOrigin(otroPuertoEnHost, 3081), false);
});

test('un dominio rebindado a 127.0.0.1 ya no pasa', () => {
  // Origin y Host se dan la razón entre sí, y ninguno de los dos es el arnés.
  const rebinding = req({ headers: { host: 'evil.example:3081', origin: 'http://evil.example:3081' } });
  assert.equal(isSameOrigin(rebinding, 3081), false);
});

test('Origin null (una página file:// o un iframe aislado) se rechaza siempre', () => {
  const nula = req({ headers: { host: '127.0.0.1:3081', origin: 'null' } });
  assert.equal(isSameOrigin(nula, 3081), false);
  assert.equal(isSameOrigin(nula), false);
});

test('guard() con el puerto esperado deja pasar lo propio y rechaza lo ajeno', () => {
  const propio = req({ method: 'POST', headers: { host: '127.0.0.1:3081', origin: 'http://127.0.0.1:3081' } });
  assert.equal(guard(propio, fakeResponse(), ['GET', 'POST'], null, 3081), true);
  const ajeno = req({ method: 'POST', headers: { host: '127.0.0.1:3081', origin: 'http://127.0.0.1:5555' } });
  assert.equal(guard(ajeno, fakeResponse(), ['GET', 'POST'], null, 3081), false);
});

/**
 * A voice id becomes part of a filesystem path, so the only thing worth
 * testing here is that it can never point outside the voices folder.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { synthesize } from '../lib/speak.js';

const ESCAPES = [
  '../../../etc/passwd',
  '..\..\Windows\System32\config\SAM',
  'sub/dir/voice',
  'sub\dir\voice',
  '..',
  '',
];

test('a voice id cannot climb out of the voices folder', async () => {
  for (const voice of ESCAPES) {
    const result = await synthesize({ text: 'hola', voice, voicesDir: 'C:/does-not-exist' });
    assert.equal(result.ok, false, voice);
    assert.match(result.reason, /voice name is not valid/, voice);
  }
});

test('a normal voice id gets past the name check and fails on the missing engine instead', async () => {
  const result = await synthesize({ text: 'hola', voice: 'es_ES-carlfm-x_low', voicesDir: 'C:/does-not-exist' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Piper engine was not found/);
});

test('nothing to read is refused before anything is spawned', async () => {
  const result = await synthesize({ text: '   ', voice: 'es_ES-carlfm-x_low', voicesDir: 'C:/does-not-exist' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /nothing to read/);
});

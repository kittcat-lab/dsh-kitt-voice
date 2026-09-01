/**
 * The splitter decides what the synthesiser is asked to say. Getting it wrong
 * means replies cut off mid-sentence, so its promises are worth pinning down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkForSpeech } from '../lib/chunk.js';

test('empty input produces nothing to say', () => {
  assert.deepEqual(chunkForSpeech(''), []);
  assert.deepEqual(chunkForSpeech('   \n  '), []);
  assert.deepEqual(chunkForSpeech(null), []);
});

test('no piece is ever longer than the limit', () => {
  const long = 'palabra '.repeat(400);
  for (const piece of chunkForSpeech(long, 200)) assert.ok(piece.length <= 200);
});

test('a word longer than the limit is still split rather than dropped', () => {
  const pieces = chunkForSpeech('x'.repeat(500), 100);
  assert.ok(pieces.length >= 5);
  for (const piece of pieces) assert.ok(piece.length <= 100);
});

test('code blocks are named, not read character by character', () => {
  const spoken = chunkForSpeech('Mira esto:\n```js\nconst a = 1\n```\nY ya.').join(' ');
  assert.match(spoken, /code block/);
  assert.doesNotMatch(spoken, /const a = 1/);
});

test('markdown decoration is not pronounced', () => {
  const spoken = chunkForSpeech('El **setup** tiene `understeer` y # mucho').join(' ');
  assert.doesNotMatch(spoken, /[*`#]/);
  assert.match(spoken, /setup/);
});

test('sentences are kept whole when they fit', () => {
  const pieces = chunkForSpeech('Uno. Dos. Tres.', 200);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0], 'Uno. Dos. Tres.');
});

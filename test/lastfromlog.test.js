import test from 'node:test';
import assert from 'node:assert/strict';

import { lastAssistantText } from '../lib/lastfromlog.js';

/** A fake store shaped like the harness's: get(id) -> { events }. */
const store = (events) => ({ get: () => ({ events }) });

test('takes the LAST assistant message, not the first', () => {
  const events = [
    { type: 'assistant/message', data: { message: { content: 'lo viejo' } } },
    { type: 'user/message', data: { message: { content: 'y luego' } } },
    { type: 'assistant/message', data: { message: { content: 'lo último' } } },
  ];
  assert.equal(lastAssistantText(store(events), 'x'), 'lo último');
});

test('reads content parts, and only the spoken ones', () => {
  const events = [{
    type: 'assistant/message',
    data: { message: { content: [
      { type: 'text', text: 'Frena antes. ' },
      { type: 'tool_use', name: 'setup', input: {} },
      { type: 'text', text: 'Y gira más tarde.' },
    ] } },
  }];
  assert.equal(lastAssistantText(store(events), 'x'), 'Frena antes. Y gira más tarde.');
});

test('skips an empty reply and keeps looking back', () => {
  const events = [
    { type: 'assistant/message', data: { message: { content: 'lo que sí se dijo' } } },
    { type: 'assistant/message', data: { message: { content: '   ' } } },
  ];
  assert.equal(lastAssistantText(store(events), 'x'), 'lo que sí se dijo');
});

test('never throws: a fallback that breaks its own route is worse than none', () => {
  const explota = { get() { throw new Error('boom'); } };
  assert.equal(lastAssistantText(explota, 'x'), '');
  assert.equal(lastAssistantText(null, 'x'), '');
  assert.equal(lastAssistantText(store([]), ''), '');
  assert.equal(lastAssistantText({ get: () => undefined }, 'x'), '');
  assert.equal(lastAssistantText({ get: () => ({ events: 'no es una lista' }) }, 'x'), '');
});

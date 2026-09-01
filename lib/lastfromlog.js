/**
 * The last thing the agent said, recovered from the session's own log.
 *
 * The plugin normally remembers the last reply as it streams past. That memory
 * dies with the process, so after restarting the harness the reply is still on
 * screen and the speaker button says there is nothing to read — which is, from
 * where the person is sitting, simply false.
 *
 * The harness keeps every session as an append-only log, and the assembled
 * reply for each step is one of its events. Reading backwards from the end
 * finds the last one. Nothing is written anywhere: the log is the harness's,
 * this only looks at it.
 */

/** Text out of an assistant message, whatever shape its content takes. */
function textOf(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Content parts: only the spoken ones. A tool call is not something to
    // read out loud, and neither is the model's private reasoning.
    return content
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

/**
 * lastAssistantText(sessions, sessionId) -> string
 *
 * Empty string when there is nothing to read, when the session is gone, or
 * when the store behaves differently from what is expected here. This is a
 * fallback: it must never be the thing that breaks the route it helps.
 */
export function lastAssistantText(sessions, sessionId) {
  if (!sessions || !sessionId) return '';
  let session;
  try { session = sessions.get(sessionId); } catch { return ''; }
  if (!session) return '';

  let events;
  try { events = session.events; } catch { return ''; }
  if (!Array.isArray(events)) return '';

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'assistant/message') continue;
    const text = textOf(event.data && event.data.message).trim();
    if (text) return text;
  }
  return '';
}

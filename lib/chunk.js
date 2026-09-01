/**
 * Splitting a reply into speakable pieces.
 *
 * Synthesisers choke on long paragraphs: they cut off mid-sentence and stop.
 * So a reply is broken at sentence ends, never mid-word, and each piece is
 * spoken in turn. Markdown decoration is removed first, because asterisks and
 * backticks read aloud as noise, and code blocks are replaced by a short
 * spoken marker instead of being read character by character.
 *
 * Pure: no browser, no audio, no side effects. Easy to test.
 */

const DEFAULT_MAX = 200;

/**
 * LO QUE NO SE PRONUNCIA.
 *
 * Un agente escribe para una pantalla: viñetas, flechas, emojis, cajas de
 * dibujar tablas. Leído en alto eso no es decoración, es ruido — y cada motor
 * lo destroza a su manera: unos nombran el emoji entero («cara sonriente con
 * ojos de corazón»), otros sueltan un chasquido, otros se atascan y cortan la
 * frase. Ninguno de los tres es aceptable cuando estás en otra cosa y solo
 * escuchas.
 *
 * Así que se quita todo lo que solo es dibujo, y lo que SÍ significa algo se
 * traduce a lo que un lector humano haría con ello: una viñeta es una pausa,
 * una flecha es «a», una raya larga es una pausa. La puntuación de verdad y
 * los números no se tocan nunca.
 */

/** Bloques de dibujo puro: emojis, banderas, símbolos, cajas, iconos. */
const SOLO_DIBUJO = new RegExp(
  '[' +
  '\\u{1F000}-\\u{1FAFF}' +   // emojis, fichas, símbolos suplementarios
  '\\u{1F1E6}-\\u{1F1FF}' +   // las letras que forman banderas
  '\\u{2600}-\\u{27BF}' +     // símbolos varios y dingbats
  '\\u{2B00}-\\u{2BFF}' +     // flechas y formas sueltas
  '\\u{2500}-\\u{257F}' +     // cajas de dibujar tablas
  '\\u{FE00}-\\u{FE0F}' +     // el selector que pone «esto en color»
  '\\u{200D}' +               // el pegamento entre emojis
  ']', 'gu');

/** Lo que significa algo: se dice, no se borra. */
const SE_DICEN = [
  [/[→⇒➔➜➞➡]/g, ' a '],
  [/[←⇐⬅]/g, ' desde '],
  [/[—–]/g, ', '],           // raya larga: una pausa, como al leer
  [/[•·▪◦‣]/g, ', '],        // viñeta: la pausa entre puntos de una lista
  [/[«»“”„‟]/g, '"'],
  [/[‘’‚‛]/g, "'"],
  [/…/g, '. '],
  [/[✓✔]/g, ' sí '],
  [/[✗✘×]/g, ' no '],
];

/** Replace code blocks, drop decoration that should not be pronounced. */
function stripMarkdown(text) {
  let limpio = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`/g, '')
    .replace(/[*#_]/g, '');

  for (const [patron, dicho] of SE_DICEN) limpio = limpio.replace(patron, dicho);
  limpio = limpio.replace(SOLO_DIBUJO, ' ');

  // Lo quitado deja huecos y comas huérfanas: una línea que era «✅ Hecho»
  // no puede acabar siendo « , Hecho».
  return limpio
    .replace(/[ \t]{2,}/g, ' ')
    // Espacios, NUNCA saltos de línea: un `\s` aquí se come el salto de una
    // lista y pega los puntos unos con otros.
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([,;:])[ \t]*(?=[,.;:!?])/g, '')
    .replace(/^[ \t]*[,;:][ \t]*/gm, '');
}

/** Split at sentence ends, keeping the punctuation with its sentence. */
function intoSentences(text) {
  return (text.match(/[^.!?:\n]*[.!?:\n]+|[^.!?:\n]+/g) || [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Last resort: split on spaces, and a single over-long word by force. */
function bySpaces(text, max) {
  const pieces = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) pieces.push(current);
    if (word.length > max) {
      for (let i = 0; i < word.length; i += max) pieces.push(word.slice(i, i + max));
      current = '';
    } else {
      current = word;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** A sentence longer than max: split on commas first, then on spaces. */
function longSentence(text, max) {
  const pieces = [];
  let current = '';
  for (const part of text.split(/(?<=,)\s*/)) {
    if (!part) continue;
    if (part.length > max) {
      if (current) { pieces.push(current); current = ''; }
      pieces.push(...bySpaces(part, max));
      continue;
    }
    const candidate = current ? current + part : part;
    if (candidate.length <= max) {
      current = candidate;
    } else {
      pieces.push(current);
      current = part;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * chunkForSpeech(text, max = 200) -> string[]
 * No piece is ever longer than `max`. Empty input gives an empty list.
 */
export function chunkForSpeech(text, max = DEFAULT_MAX) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : DEFAULT_MAX;
  const clean = stripMarkdown(text);
  if (!clean.trim()) return [];

  const pieces = [];
  let current = '';
  for (const sentence of intoSentences(clean)) {
    if (sentence.length > limit) {
      if (current) { pieces.push(current); current = ''; }
      pieces.push(...longSentence(sentence, limit));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      pieces.push(current);
      current = sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

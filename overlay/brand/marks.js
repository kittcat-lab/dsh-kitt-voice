// The marks the companion window wears.
//
// Drawn here rather than pasted in as a picture: a few hundred bytes of
// drawing instead of a hundred and thirty kilobytes of image, it stays sharp
// on any screen, and — the reason it matters here — the halo that says what is
// happening is cast from the mark's own silhouette, so a shape with clean
// edges gets a clean halo.
//
//   symbol   the mark alone — a small badge, discreet
//   wordmark the full logotype — wider, reads as the product from across the room
//
// TO WEAR A DIFFERENT BRAND, change nothing here. Put a `marks.local.js` next
// to this file setting `window.OVERLAY_MARKS` to your own two images; it is
// loaded after this one and wins. That file is not tracked, so a private brand
// never travels with a public repository.

(function () {
  // The quiet palette is deliberate. The window's halo carries the state —
  // listening, thinking, reading — and a mark competing with it makes both
  // harder to read at a glance.
  const TINTA = '#e9edf2';        // the glyph
  const FONDO = '#161a1f';        // the badge
  const BORDE = '#3a434e';        // just enough edge to sit on any wallpaper

  /** A microphone over three level bars: what the thing does, in one glance. */
  const glifo = (x, y, escala) => `
    <g transform="translate(${x},${y}) scale(${escala})" fill="none"
       stroke="${TINTA}" stroke-width="7" stroke-linecap="round">
      <path d="M32 6a10 10 0 0 1 10 10v20a10 10 0 0 1-20 0V16A10 10 0 0 1 32 6z"/>
      <path d="M14 34a18 18 0 0 0 36 0"/>
      <path d="M32 52v8"/>
      <path d="M12 68h40" stroke-opacity=".45"/>
    </g>`;

  const svg = (ancho, alto, dentro) =>
    'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">${dentro}</svg>`
    );

  const insignia = (ancho, alto, radio) =>
    `<rect x="2" y="2" width="${ancho - 4}" height="${alto - 4}" rx="${radio}"
       fill="${FONDO}" stroke="${BORDE}" stroke-width="3"/>`;

  window.OVERLAY_MARKS = {
    symbol: svg(128, 128, insignia(128, 128, 30) + glifo(32, 25, 1.0)),
    wordmark: svg(236, 96,
      insignia(236, 96, 26) +
      glifo(24, 16, 0.82) +
      `<text x="112" y="58" font-family="Segoe UI, Inter, system-ui, sans-serif"
         font-size="34" font-weight="600" letter-spacing="1" fill="${TINTA}">KITT</text>
       <text x="112" y="76" font-family="Segoe UI, Inter, system-ui, sans-serif"
         font-size="13" letter-spacing="3.5" fill="${TINTA}" fill-opacity=".55">FOR DSH</text>`),
  };
})();

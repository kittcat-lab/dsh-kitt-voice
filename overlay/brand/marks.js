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
  // EL LOGOTIPO ES LA K, no un micrófono.
  //
  // Aquí había un micrófono dibujado, con el argumento de que un icono que
  // describe lo que hace la cosa vale más que un logotipo. Es un buen
  // argumento y era el correcto mientras el producto no tenía marca. Ya la
  // tiene, y una marca sirve justo para lo que un icono descriptivo no puede:
  // que quien la ve dos veces sepa de quién es.
  //
  // El trazado es el del logotipo, tal cual, en su lienzo de 28×28; se
  // reescala pero no se redibuja. Un logotipo retocado a mano deja de ser el
  // mismo en cuanto alguien cambia el de la web.
  const K = 'M4 3h5v8.1L17.1 3H24l-8.7 10L24.5 25h-7.1L9 15.3V25H4V3Z';

  const VERDE = '#b7ff54';        // el verde de la marca
  const TINTA = '#e9edf2';        // el texto
  const FONDO = '#161a1f';        // la insignia
  const BORDE = '#3a434e';        // el borde justo para asentarse en cualquier fondo

  /** La K en su sitio, a la escala que le toque. 28 unidades de lado. */
  const marca = (x, y, lado) =>
    `<g transform="translate(${x},${y}) scale(${lado / 28})">
       <path d="${K}" fill="${VERDE}"/>
     </g>`;

  const svg = (ancho, alto, dentro) =>
    'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">${dentro}</svg>`
    );

  const insignia = (ancho, alto, radio) =>
    `<rect x="2" y="2" width="${ancho - 4}" height="${alto - 4}" rx="${radio}"
       fill="${FONDO}" stroke="${BORDE}" stroke-width="3"/>`;

  const rotulo =
    `<text x="88" y="56" font-family="Segoe UI, Inter, system-ui, sans-serif"
       font-size="34" font-weight="600" letter-spacing="1" fill="${TINTA}">KITT</text>
     <text x="88" y="76" font-family="Segoe UI, Inter, system-ui, sans-serif"
       font-size="13" letter-spacing="3.5" fill="${TINTA}" fill-opacity=".55">FOR DSH</text>`;

  /* ENCENDIDA, DEL COLOR DEL ESTADO.
   *
   * La K es el mando del modo KITT. En reposo es la marca tal cual: la K
   * verde sobre la insignia oscura. Con el modo en marcha, la insignia toma
   * el color de lo que está pasando —azul esperando, verde escuchando, rojo
   * hablando— y la K se pone blanca para que se lea sobre cualquiera de los
   * tres. Los colores los decide la ventana, que es quien sabe el estado; aquí
   * sólo se dibuja. Se guarda cada dibujo hecho: son tres o cuatro y se piden
   * varias veces por segundo.
   *
   * Una marca privada (marks.local.js) que no traiga `encendida` sigue
   * valiendo: la ventana enciende entonces la que tenga con un halo. */
  const BLANCO = '#ffffff';
  const letraEn = (x, y, lado, color) =>
    `<g transform="translate(${x},${y}) scale(${lado / 28})">
       <path d="${K}" fill="${color}"/>
     </g>`;
  const insigniaDe = (ancho, alto, radio, fondo) =>
    `<rect x="2" y="2" width="${ancho - 4}" height="${alto - 4}" rx="${radio}"
       fill="${fondo}" stroke="rgba(255,255,255,.45)" stroke-width="3"/>`;
  const hechas = new Map();
  const encendida = (forma, color) => {
    const clave = `${forma}|${color}`;
    if (!hechas.has(clave)) {
      hechas.set(clave, forma === 'wordmark'
        ? svg(236, 96, insigniaDe(236, 96, 26, color) + letraEn(22, 24, 48, BLANCO) + rotulo)
        : svg(128, 128, insigniaDe(128, 128, 30, color) + letraEn(30, 30, 68, BLANCO)));
    }
    return hechas.get(clave);
  };

  window.OVERLAY_MARKS = {
    symbol: svg(128, 128, insignia(128, 128, 30) + marca(30, 30, 68)),
    wordmark: svg(236, 96, insignia(236, 96, 26) + marca(22, 24, 48) + rotulo),
    encendida,
  };
})();

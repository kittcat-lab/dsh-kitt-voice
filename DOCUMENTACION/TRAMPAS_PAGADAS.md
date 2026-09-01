# Las trampas ya pagadas

Dieciséis fallos que costaron una tarde entera cada uno. **Todos salieron
USÁNDOLO, ninguno leyendo el código, y ninguno daba un error** — por eso están
escritos: son justo los que no se encuentran mirando.

Antes de tocar la parte que le toque a cada uno, se lee la suya. Y si alguna
vuelve a aparecer, es una regresión y pesa más que un hallazgo nuevo.

---

## En el arnés y sus rutas

1. **Cordis no deja ni LEER una propiedad del contexto que no hayas declarado
   en `inject`.** No devuelve vacío: revienta. Y dentro de una ruta eso llega
   como un **400 pelado, sin una palabra**.
2. **Una ruta `prefix` con barra al final no casa con NADA.** El contrato dice
   «absolute pathname, no trailing slash». Con la barra cae al 404 de reserva,
   que es un 404 **vacío** — idéntico a «ese fichero no está».
3. **Cómo se distinguen esos dos:** por el código **y el tamaño**. Un 404 de 0
   bytes es del arnés; uno con JSON dentro es del plugin. Un 400 sin cuerpo es
   una ruta que ha reventado.
4. **Un socket que muere se lleva el arnés entero.** Una conexión mantenida
   abierta levanta `error` al cerrarse, y un `error` sin nadie escuchando no
   falla la petición: mata el proceso — **sin una línea en el registro**.
   Escúchalo en las cuatro formas: `req.close`, `req.error`, `res.close`,
   `res.error`.

## En la página del navegador

5. **Una pestaña de fondo no tiene reloj.** Chrome frena sus temporizadores a
   uno por segundo, y a los pocos minutos a uno por MINUTO. Todo lo que
   dependa de un temporizador **deja de funcionar justo cuando hace falta**,
   que es con otra aplicación delante. Las órdenes se EMPUJAN desde el
   servidor por una ruta que se queda abierta: una llamada de red no es un
   reloj y no la frenan.
6. **Un manejador que mira el estado del render en el que se registró se traga
   las órdenes.** Una orden llega de fuera, o sea que cae en una página que
   quizá no se ha vuelto a pintar. Consulta el estado **en el momento en que
   llega la orden**. Síntoma: funciona una vez y nunca más, en silencio.
7. **Al enviar, el arnés puede abrir una sesión NUEVA.** Quedarse con el
   identificador de antes es esperar una respuesta que está llegando a otro
   sitio. Síntoma: «el agente no ha contestado» con la respuesta en pantalla.
8. **Un turno del agente son VARIOS pasos.** Piensa, llama a una herramienta,
   mira lo que sale, y sigue — y cada paso es un flujo que empieza y TERMINA.
   Tomar el primer final por el del turno hace que anuncies que no ha
   contestado mientras está contestando. Y cada paso empieza su texto **de
   cero**, así que lo que llega puede ser MÁS CORTO que lo anterior: comparando
   longitudes se pierden pasos enteros; hay que comparar el texto.
9. **No le pongas reloj al agente.** Uno que sale a buscar algo tarda lo que
   tarda. Esperar no es un fallo, y una ventana que se pone roja por eso te
   enseña a no mirar el color.

## En la ventana flotante

10. **Una ventana transparente y siempre encima deja una sombra pegada a la
    pantalla al moverla.** No son dos ventanas —se insistió en que lo eran, y
    era falso—: es el escritorio sin repintar. La cura son dos interruptores, y
    los dos **antes** de que arranque la app:
    `app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')`
    y `app.disableHardwareAcceleration()`.
    **Y lo mismo al ENCOGER**, que es otro caso: al cerrar el menú, la ventana
    pasa de 480 de alto a 44 y lo que ocupaba el panel se queda pintado. Ahí
    los dos interruptores no llegan, porque no se mueve nada: desaparece
    superficie. Se esconde y se vuelve a mostrar, que obliga a repintar.
11. **Una ventana que no coge el foco no se arrastra** con
    `-webkit-app-region: drag`: Windows no le manda el clic. Hay que seguir el
    puntero desde el proceso principal.
12. **Una ventana que se arrastra se ESTIRA si le lees el tamaño.** Leerlo y
    volver a dárselo sesenta veces por segundo, en una pantalla que no está al
    100%, acumula un redondeo que sólo va hacia arriba: de 258x44 a 276x62 y
    subiendo. `setPosition` tampoco vale — medido. El tamaño se impone desde
    una constante, nunca se lee de la ventana.
13. **La segunda instancia borra los ajustes de la primera.** Cerrarse es
    asíncrono: la que pierde el cerrojo todavía arranca, falla al registrar
    unos atajos que ya tiene la otra, y escribe ese fallo —cuatro nulos—
    encima de los ajustes buenos. Las teclas dejan de funcionar y nadie lo
    dice. La que pierde no debe tocar nada.
14. **Matar el arnés a lo bruto deja la ventana huérfana.** La ventana flotante
    es un proceso APARTE: cuando el arnés se cierra bien, él la cierra. Si se
    mata sin dejarle recoger —un `taskkill /F`, un `Stop-Process -Force`—, la
    barra se queda viva y sola en la pantalla, sin nadie que la cierre y sin
    servidor con quien hablar. No está colgada: está huérfana. Se cierra con su
    aspa. Reiniciar el arnés a lo bruto varias veces seguidas deja una barra
    por reinicio.
15. **Un nulo guardado pisa al valor por defecto.** Los cuatro atajos
    figuraban como `null` en el fichero de la ventana, y al arrancar esos nulos
    ganaban a F8–F11: las teclas no hacían nada y nadie lo decía. Filtra lo que
    de verdad se eligió antes de mezclarlo con los valores de fábrica.

## De cómo se dicen las cosas

16. **«Escuchando» no puede significar «el micrófono está abierto».** Puesto
    así, la pantalla dice «Escuchando» sin parar y quien lo lee entiende que le
    están grabando entero. Significa que hay una voz AHORA. Entre turno y
    turno, reposo.

---

## Y tres de medir, que valen para cualquier proyecto

- **Una vista de prueba que renombra los identificadores no mide nada.** Dejó
  de entrarle el CSS y dio cifras de un diseño que no existía. Si mides, mide
  la cosa tal cual es.
- **Contar con un patrón mal escrito es peor que no contar.** Se dio por
  traducidas nueve frases porque el patrón tomaba por tercera traducción
  cualquier coma dentro del texto. Eran cero. Un número inventado se propaga a
  todo lo que se decida con él.
- **Un fichero de ajustes se puede corromper al reescribirlo.** Las tildes
  quedaron dobles («MicrÃ³fono»), el nombre del micrófono dejó de casar con
  ningún aparato, y la aplicación no dio ni un error: simplemente eligió el
  aparato de por defecto. Al tocar un fichero con acentos, se comprueba
  después leyéndolo.

## Y una que asusta sin morder

**«Un paquete tiene scripts de instalación que no se han ejecutado» no siempre
significa que falte algo.** El aviso que sale al instalar es por `msedge-tts`, y
su `preinstall` es `npx only-allow pnpm`: no construye nada, es un cerrojo para
obligar a *sus* colaboradores a usar pnpm, y bajo npm **falla a propósito**. O
sea que saltárselo no es que sea inofensivo — es que es lo correcto: aprobarlo
rompe la instalación en vez de arreglarla.

Se midió antes de escribirlo, que es la gracia: instalación limpia, `npm
install` termina en 0, la librería lista 322 voces y devuelve audio de verdad,
sin construir nada y sin una sola voz local instalada. **Un aviso no es un
fallo, pero tampoco se despacha con un «seguro que no pasa nada»: se comprueba.**

## Y una que dejó de ser verdad

Durante meses estuvo escrito que **`dsh plugin remove` se llevaba por delante
los enlaces del perfil**, y que había que editar el `package.json` a mano. Se
volvió a medir el 1-sep-2026 contra el código del propio comando instalado:
hoy **reconcilia la lista contra lo que hay instalado**, así que ya no es
cierto y el README dice lo de hoy.

Se queda escrita aquí como recordatorio de lo otro: **una trampa también
caduca**, y repetirla cuando ya no pasa es tan malo como no haberla escrito.

# Las trampas ya pagadas

*[English](TRAPS.md) | [简体中文](TRAPS.zh.md)*

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

## Y una que asusta con npm pero muerde con pnpm

**«Un paquete tiene scripts de instalación que no se han ejecutado» es un aviso
con npm y un error con pnpm.** El script es el `preinstall` de `msedge-tts`,
`npx only-allow pnpm`: no construye nada, es un cerrojo para obligar a *sus*
colaboradores a usar pnpm, y fuera de ahí falla a propósito. Saltárselo no es
que sea inofensivo — es que es lo correcto.

Con npm ahí se acaba: medido en limpio, `npm install` termina en 0, la librería
lista 322 voces y devuelve audio de verdad, sin construir nada y sin una sola
voz local instalada.

**Con pnpm —que es lo que usa un perfil del arnés— esa misma situación tumba el
comando entero** con `[ERR_PNPM_IGNORED_BUILDS]`. Y pnpm no decide por ti: te
escribe `msedge-tts: set this to true or false` en el `pnpm-workspace.yaml` del
perfil y lo deja ahí. Mientras nadie decida, falla **cualquier** instalación en
ese perfil —también la de plugins de otra gente—, así que el siguiente que se lo
coma no tiene motivo para sospechar de éste. Se pone en `false`.

Salió instalando un plugin que no tenía nada que ver en un perfil que ya tenía
éste. **Un aviso en un gestor de paquetes no es un aviso en el siguiente: la
misma situación hay que medirla en el que va a usar la gente.**

## Y la que tenía escrita y me comí igual

**Leer un fichero UTF-8 sin decir que lo es lo vuelve a codificar, y no protesta
nadie.** Se leyó con una herramienta que por defecto usa la codificación del
sistema, se editó, y se guardó como UTF-8. El chino que había dentro quedó
codificado dos veces — un muro de `å…³äºŽ` donde antes había texto. Ni un error
ni un comando fallido: se publicó tal cual, y se encontró después porque una
búsqueda ya no casaba con su propia cabecera.

La trampa de los ficheros que se corrompen al reescribirlos estaba escrita tres
secciones más arriba. Tenerla escrita no es lo mismo que leerla. **Después de
tocar cualquier fichero con tildes o con alfabeto no latino, se vuelve a leer y
se comprueba** — y si la comprobación puede ser una línea de código en vez de un
par de ojos, que lo sea.

## El cliente se sirve como UN fichero, y un import mata el plugin entero

**`lib/client.js` no tiene imports, y eso no es casualidad.** Se le sirve al
navegador como un fichero suelto —sin empaquetador— y el arnés lo carga con su
propio cargador de módulos.

Métele un `import` de un fichero hermano y el arnés se para con esto:

    failed to import loader entry (dsh-kitt-voice): client-modules: bundle
    /plugins/dsh-kitt-voice/client.js loaded without registering
    "dsh-kitt-voice" via __ModuleLoader__.load

**Y se va el plugin ENTERO, no sólo esa función**: ni micrófono, ni ventana, ni
botones. La propia página del arnés dice «Failed to load plugins» y nada apunta
al import.

Pasó haciendo lo ordenado: se sacó la lógica del corte a `lib/corte.js` para
poder probarla sin un navegador, y se importó de vuelta. **Todas las pruebas
seguían en verde** — importan el módulo directamente en Node, donde los imports
funcionan de sobra. Lo encontró alguien abriendo la aplicación.

**Así que la lógica vive dentro del cliente, y `lib/corte.js` es una segunda
copia que existe sólo para poder probarla.** Duplicar es malo; duplicar con una
prueba que salta en cuanto las dos se separan es lo único que funciona aquí. Esa
prueba además rechaza cualquier línea `import` en `client.js`.

Y la lección no va de este plugin: **una limpieza que aprueban todas las
pruebas puede ser justo lo que tumbe el producto.** Si las pruebas no cargan el
código como lo carga producción, no están probando eso.

## Y una que dejó de ser verdad

Durante meses estuvo escrito que **`dsh plugin remove` se llevaba por delante
los enlaces del perfil**, y que había que editar el `package.json` a mano. Se
volvió a medir el 1-sep-2026 contra el código del propio comando instalado:
hoy **reconcilia la lista contra lo que hay instalado**, así que ya no es
cierto y el README dice lo de hoy.

Se queda escrita aquí como recordatorio de lo otro: **una trampa también
caduca**, y repetirla cuando ya no pasa es tan malo como no haberla escrito.

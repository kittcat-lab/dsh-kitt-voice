# DSH KITT

Voz para la interfaz web del
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), pensada en
español y utilizable sin tener el navegador delante.

Pulsas una tecla, dices lo que quieras, y el agente te contesta en voz alta.
Una ventana pequeña flota por encima de lo que estés haciendo y te dice qué
está pasando.

> **Estado: funciona, es reciente.** La conversación hablada, la ventana
> flotante y las teclas globales están hechas y se usan a diario. La interfaz
> habla español, inglés y chino simplificado. Whisper local no está escrito;
> ver [Lo que falta](#lo-que-falta).

## Por qué otro plugin de voz

Ya existen buenos plugins de voz para el arnés. Hay dos cosas que ninguno hace,
y una de ellas no es cuestión de ganas:

- **No entienden español.** Sus reconocedores están hechos para chino e inglés.
  `dsh-kitt-voice` usa Whisper, que sí es multiidioma, y Piper para hablar, que tiene
  voces españolas buenas y funciona en local.
- **Dejan de funcionar en cuanto el navegador pierde el foco** — porque un
  plugin vive dentro de una página, y una página no puede oír una tecla que no
  le han dado, ni verse por encima de un juego a pantalla completa. Para eso
  está la ventana flotante.

## Qué hace

- **Una conversación hablada, no un dictado.** Pulsas una vez y hablas. Oye
  cuándo has terminado, transcribe, envía, espera la respuesta y te la lee, y
  vuelve a escuchar. Ni un botón entre un turno y el siguiente.
- **Distingue una voz de un ruido.** Decidir que has terminado de hablar
  midiendo el volumen no vale en una habitación con ruido — una tele, música,
  un motor por los altavoces: cualquier ruido pasa por voz, y en manos libres
  eso es mandarle basura al agente en tu nombre. Lo decide un detector de verdad, Silero.
  Medido aquí con el listón en 0,30: silencio 0,04, ruido de motor 0,13,
  zumbido grave 0,10, pitido 0,16. Los tres últimos, a volumen alto, habrían
  engañado a cualquier medidor.
- **Pulsar y hablar, si lo prefieres.** Pulsas el micrófono o tu tecla, hablas,
  vuelves a pulsar. El texto cae en la caja del mensaje; tú decides cuándo
  enviarlo.
- **Lectura en voz alta según llega.** En una conversación, la respuesta se lee
  frase a frase mientras el agente todavía la escribe, para que una respuesta
  larga no empiece con quince segundos de silencio. Una frase no sale hasta que
  llega su final: media frase y una pausa suena a avería. Los bloques de código
  se nombran, no se deletrean.
- **Se le puede cortar.** Le hablas encima mientras lee y se calla. El listón
  no es un número elegido de antemano: durante el primer medio segundo de cada
  respuesta el micrófono escucha, y lo que oye **es** el eco, porque todavía no
  ha hablado nadie. Para contar como voz hay que pasar ese suelo por tres y
  sostenerlo un tercio de segundo. Se vuelve a medir en cada respuesta, así que
  ponerse los cascos a mitad de sesión se adapta solo, y un portazo dura menos
  de lo necesario para dispararlo.
- **Una voz que se deja escuchar.** 104 voces neuronales, agrupadas por
  idioma y por país: 45 en español —España y todos los países de América—, 47
  en inglés y 12 en chino. Las pone el servicio de lectura de Edge, sin clave y
  sin cuenta, y **el precio se dice claro: el texto de la respuesta sale de tu
  máquina.** Nada más sale.
- **A tu ritmo.** La velocidad de lectura se regula de la mitad al doble, y
  vale para los tres motores: la voz del sistema, Piper y las neuronales.
  Escuchar no es leer, y una respuesta larga a un ritmo que no es el tuyo se
  sigue mal. Se cambia desde el menú de la ventana, sin tocar ficheros.
- **La conversación llama.** Se abre con una nota que sube y se cuelga con una
  que baja, para que sepas solo por el sonido que te está escuchando — que es
  justo cuando no estás mirando la pantalla.
- **La interfaz habla tres idiomas.** Español, inglés y chino simplificado, en
  la página y en la ventana flotante. El idioma de la ventana se elige en su
  propio menú y es independiente del idioma en que dictas.
- **O no sale nada.** Si le indicas una carpeta de voces de Piper, la síntesis
  ocurre aquí, sin internet. Y sin ninguna de las dos, sigue hablando con la voz
  que la máquina ya trae. Habla desde el primer minuto; las voces buenas son una
  mejora, no un requisito.
- **Teclas que funcionan en cualquier sitio.** Asignas una tecla global y le
  hablas al agente desde cualquier aplicación — un juego, un editor, lo que
  tengas delante. Un botón del volante mapeado a esa tecla también vale.
- **Eliges los aparatos.** El micrófono y la salida de sonido se eligen por
  separado, porque el micrófono bueno y el altavoz bueno casi nunca son el
  mismo aparato.
- **Siempre dice qué está pasando** —escuchando, transcribiendo, hablando— y
  cuando algo falla dice qué parte ha fallado y por qué.

## Instalación

```
dsh plugin --profile web add dsh-kitt-voice
```

El comando instala el paquete en el perfil del arnés y añade el plugin a la
lista de bundles del perfil por su cuenta (una dependencia que declara
`dsh.bundle` entra sola en la pila de capas). Reinicia el arnés — párralo del
todo, no lo relances sin más, o seguirás hablando con el proceso viejo. En la
fila de herramientas de la caja de escribir aparecen un micrófono y un
altavoz.

Para deshacerlo:

```
dsh plugin --profile web remove dsh-kitt-voice
```

El mismo comando reconcilia la lista de bundles y quita solo este plugin. El
consejo viejo de editar el `package.json` a mano pertenece a una versión
anterior del CLI, que reescribía la lista entera; el actual reconcilia por el
estado instalado.

**Desde una copia del repositorio en vez de npm:** apunta el perfil al clon.

```
dsh plugin --profile web add link:/ruta/absoluta/a/dsh-kitt-voice
```

Si tu arnés usa otro nombre de perfil, cambia `web` por el tuyo.

### Sobre el aviso que imprime tu gestor de paquetes

Al instalar se menciona una dependencia cuyos scripts de instalación no se han
ejecutado: `msedge-tts`, cuyo `preinstall` es `npx only-allow pnpm`.

**No falta nada, y ese script no debe ejecutarse.** No construye nada: es un
cerrojo que la librería usa para obligar a *sus* colaboradores a trabajar con
pnpm, y bajo cualquier otro gestor falla a propósito. La librería se publica con
el JavaScript ya compilado y no tiene código nativo.

**Con npm es solo un aviso** y la instalación termina bien. Medido en una máquina
limpia: `npm install` termina en 0, la librería lista 322 voces y devuelve audio
de verdad, sin construir nada y sin voces locales instaladas.

**Con pnpm —que es lo que usa un perfil del arnés— es un error**, y tumba el
comando entero:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: msedge-tts@2.0.7
```

pnpm te deja escrito un hueco en el `pnpm-workspace.yaml` de tu perfil pidiendo
que decidas, y lo deja sin decidir:

```yaml
allowBuilds:
  msedge-tts: set this to true or false
```

Ponlo en `false` y repite el comando:

```yaml
allowBuilds:
  msedge-tts: false
```

Hazlo en cuanto lo veas, porque mientras ese hueco siga sin decidir falla
**cualquier** instalación en ese perfil —también la de plugins de otra gente—,
que es una forma bastante confusa de enterarse.

## Configuración

Todo menos la clave de transcripción está en **Ajustes → Plugins → dsh-kitt-voice**:
reconocedor, idioma, vocabulario de apoyo, carpeta de voces, voz, micrófono y
salida de sonido.

**La clave de transcripción sale del almacén de secretos del propio arnés** —
el mismo sitio donde vive la clave del agente. No hay que crear nada ni
reiniciar nada: la guardas como `GROQ_API_KEY` y el plugin la encuentra. Si la
tuya está con otro nombre, apunta `apiKeyRef` a ese nombre.

Si en el almacén no hay nada, se usan `DSH_KITT_API_KEY` o `GROQ_API_KEY` del
entorno.

La clave no se muestra en los ajustes y nunca llega al navegador. La página
solo pregunta *si* hay una configurada, por una llamada que no puede devolver
un valor. Se resuelve de nuevo en cada petición, así que cambiar de clave surte
efecto al momento.

### Reconocedores

| Opción | Necesita cuenta | Funciona dentro de una app de escritorio | Notas |
| --- | --- | --- | --- |
| Navegador (de serie) | no | **no** | Solo Chrome y Edge; el audio pasa por el fabricante del navegador |
| Groq Whisper | sí | sí | La mejor en precisión y velocidad; necesita una clave en el almacén |

El del navegador viene de serie para que alguien recién llegado pueda hablar en
segundos. No funciona dentro de Electron —el objeto existe pero el
reconocimiento falla siempre—, así que cuando el arnés va embebido en una
aplicación de escritorio el plugin cambia a Groq y lo dice.

### Español con palabras en inglés

Un hispanohablante dice `setup`, `brake bias`, `understeer` en mitad de frases
en español. Si a Whisper solo se le dice «español», los escribe fonéticamente
(`cetap`, `breik baias`) y al agente le llega basura. El **vocabulario de
apoyo** de los ajustes se le manda a Whisper para que esos términos se queden
en inglés. Edítalo para tu propio campo.

### Todo lo que se puede cambiar

| Ajuste | Qué hace |
| --- | --- |
| `speechRate` | A qué velocidad se lee la respuesta. 1 es el ritmo propio de la voz; 0,5 es la mitad y 2 el doble. Vale para los tres motores, incluida la voz del sistema, que la lee la página y no el servidor. |
| `uiLang` | Idioma de la interfaz del propio plugin: español, inglés o chino simplificado. Independiente del idioma de transcripción — puedes dictar en español con la interfaz en inglés. |
| `buttonColours` | Los mandos, cada uno de su color, o todos en blanco. Los colores dicen de un vistazo qué hace cada uno; el modo sobrio es para quien eso le resulte ruidoso. |
| `overlayAuto` | Abrir la ventana flotante sola en cuanto se usa la voz, y cerrarla con el arnés. Apagado por defecto: una ventana que aparece sola es una ventana que nadie ha pedido. |
| `micLabel` | Qué micrófono, **por nombre**. Vacío significa el que tenga el sistema por defecto. Por nombre y no por identificador a propósito: un navegador le da a cada origen identificadores distintos para el mismo aparato, así que uno elegido en la ventana flotante no significaría nada en la página. |
| `outputLabel` | Por qué altavoz o auriculares sale la respuesta, por nombre. |

## El detector de turno

La conversación en manos libres tiene que saber cuándo has terminado la frase.
Eso es un modelo —Silero v5— más su motor, y juntos pesan unos dieciséis
megas.

**No viajan dentro de este paquete.** La mayoría de la gente que instala un
plugin de voz quiere pulsar un botón y hablar; obligarles a todos a cargar
dieciséis megas por un modo que quizá nunca enciendan es una falta de respeto.
Así que llegan de una de estas dos formas, en este orden:

1. **una carpeta que ya tengas**, indicada como `vadDir` en los ajustes — no se
   baja nada;
2. **una descarga guiada**, anunciando el tamaño antes, la primera vez que
   enciendas la conversación.

En los dos casos, los ficheros se los sirve a la página **el propio arnés**, de
modo que el navegador nunca sale a internet por su cuenta, y sólo los seis
nombres de una lista fija pueden llegar a ser una ruta.

Son seis ficheros, no cinco: el paquete del detector no lleva dentro el motor
de inferencia. Espera encontrarlo ya puesto en la página, y cargado antes.

## La ventana flotante

```
cd overlay
start.cmd          Windows
./start.sh         macOS y Linux
```

Electron no viaja dentro: el arnés es una aplicación web y mucha gente no
querrá nunca una ventana de escritorio. El lanzador usa uno que ya tengas
—apunta `DSH_KITT_ELECTRON` a él— o `npm install` aquí para bajarse uno.

Una ventana pequeña con la marca flota por encima de todo, incluido un juego a
pantalla completa. En reposo no muestra más que la marca; aparece un halo de un
color que dice qué está pasando, y mientras escucha crece con el nivel medido
de tu voz — nunca con una animación inventada.

Los controles están siempre del mismo tamaño y siempre encendidos: uno que
sólo aparece cuando llega el puntero es un control que hay que descubrir, y
esta ventana se tiene que entender de un vistazo, con la atención puesta en
otra cosa. Pasar por encima sólo los ilumina.

La barra **es los mandos**, y son los mismos que verás en la fila de
herramientas del arnés: mismo dibujo, mismo color y mismo tamaño, porque son el
mismo mando en dos sitios.

- un micrófono **rojo** — pulsa, habla y pulsa otra vez; el texto cae en la
  caja del mensaje y **lo envías tú** con Enter;
- un bocadillo **azul** — el modo KITT: conversación continua, sin tocar nada
  más. Se enciende y se apaga desde cualquiera de los dos sitios;
- un micrófono tachado **ámbar** — **silenciar**. Para el detector de verdad,
  no disimula. Sirve justo cuando no estás mirando la pantalla: entra alguien a
  hablarte o pones un vídeo. Silenciar deja la conversación en espera, no la
  cuelga;
- un altavoz — volver a leer la última respuesta;
- un **engranaje** con todo lo demás: micrófono, altavoz, voz, velocidad,
  idioma y color de los botones; las teclas; callar y forma;
- y un **aspa** para cerrar la ventana sin abrir el menú. Cerrarla nunca es un
  callejón: el plugin la vuelve a abrir en cuanto se usa la voz, y el engranaje
  de la fila del arnés la abre cuando quieras.

El color del **borde** dice lo que está pasando, y se lee por el rabillo del
ojo: **nada en reposo, verde mientras te escucha —y crece con el nivel medido
de tu voz—, azul respirando mientras piensa, y rojo mientras te habla.** Si
algo falla, la palabra **ERROR** parpadeando, que se entiende sin interpretar
ningún color.

**Teclas** (se asignan en el menú): `F8` hablar y enviar, `F9` empezar o
terminar la conversación, `F7` silenciar el micrófono, `F10` volver a escuchar
la respuesta, `F11` callar. Para usar un botón del volante, mapéalo a una de
esas teclas en el software del propio volante — no hace falta nada más. Las
teclas que pertenecen a todo el sistema (Ctrl+C, Alt+F4 y compañía) se
rechazan: un atajo global le quita la tecla a **todas** las aplicaciones de la
máquina.

Usa `DSH_KITT_PORT` si tu arnés no está en el 3081. Recibe un **puerto**,
nunca una dirección: la ventana sólo puede hablar con loopback.

## Estructura

```
lib/          el plugin
  index.js      mitad servidor: ajustes, rutas HTTP, captura de la última respuesta
  client.js     mitad navegador: los controles, la grabación, la ficha de ajustes
  guard.js      quién puede llamar a las rutas
  transcribe.js voz a texto
  speak.js      texto a voz con las voces locales de Piper
  chunk.js      partir una respuesta en trozos que se puedan leer
  neural.js     las voces neuronales, y qué sale de la máquina por ellas
  overlay.js    abrir la ventana flotante cuando se usa la voz
  vad.js        los ficheros del detector de turno, y cómo llegan aquí
  lastfromlog.js recuperar la última respuesta del registro de la sesión
  apikey.js     resolver la clave, en cada llamada, sin guardarla nunca
  log.js        una línea al arrancar, y los rechazos — jamás la clave
  freshness.js  detectar un servidor corriendo una copia vieja del plugin
overlay/      la ventana flotante (su propia aplicación Electron)
  main.js       la ventana, su forma y su posición
  shortcuts.js  teclas de sistema
  requests.js   la lista cerrada de lo que la ventana puede pedir al arnés
  textos.js     todas las frases de la ventana, en los tres idiomas
  index.html    lo que dibuja
test/         las partes que merece la pena proteger
```

Las dos mitades no comparten memoria. Se hablan por trece rutas de loopback
bajo `/dsh-kitt-voice`: `config`, `settings`, `devices`, `voices`, `transcribe`,
`speak`, `last`, `state`, `command`, `orders`, y `vad/status`, `vad/download` y
`vad/file`. Todas comprueban quién las llama. El
estado va página → servidor → ventana flotante; `command` va al revés, y es por
donde una tecla pulsada fuera del navegador llega a la página.

## Seguridad

- **Cada ruta comprueba quién llama.** Loopback no es privacidad: cualquier
  página que visites puede hacer que tu navegador mande peticiones a
  `127.0.0.1`. Tienen que llegar por loopback, y una petición que traiga
  `Origin` tiene que nombrar a este mismo servidor — misma grafía de loopback,
  mismo puerto (el `Origin` y el `Host` los escribe quien llama, así que nunca
  se confía en que se pongan de acuerdo entre ellos). Las negativas no dicen
  nada de la máquina.
- **La clave de transcripción nunca llega al navegador** ni a un registro. La
  página solo sabe si hay una configurada.
- **Un nombre de voz no puede convertirse en una ruta.** Se comprueba contra un
  patrón estricto antes de unirlo a la carpeta.
- **La ventana flotante está cerrada a cal y canto**: aislamiento de contexto,
  sin Node en la página, en caja de arena, sin navegación, sin ventanas nuevas,
  sin permisos del navegador, y solo puede dirigirse a `127.0.0.1` en un puerto
  configurable — nunca a una dirección que le pasen. Su página no hace ninguna
  llamada de red: las hace el proceso principal por ella, contra una lista
  cerrada de rutas (`overlay/requests.js`), así que ni su propio código puede
  apuntarla a otro servidor.
- **Un nombre de fichero tampoco puede volverse una ruta.** Los ficheros del
  detector se sirven por nombre contra una lista fija de seis; cualquier otro
  se rechaza antes de construir ninguna ruta.
- **Las teclas globales se devuelven** al cerrar la ventana.

## Pruebas

```
npm test
```

66 pruebas, con `node --test` y sin paso de compilación. Cubren las partes
donde equivocarse sale caro: quién puede llamar a las rutas, si un nombre de
voz puede escaparse de su carpeta, qué promete el troceador de respuestas, que
el rescate desde el registro nunca reviente dentro de la ruta a la que va a
ayudar, la lista cerrada de peticiones de la ventana, el troceador de frases
de la lectura y los pasos de velocidad.

## Lo que falta

- **Whisper local.** Quitaría la necesidad de clave dentro de una aplicación de
  escritorio. Necesita gestión de modelos y conversión de audio, y no está
  escrito.
- **Cualquier cosa que no sea Windows.** Aquí no hay nada que sea sólo de
  Windows —las voces, la ventana y las teclas tienen su equivalente— pero sólo
  se ha usado en Windows. Se agradecen informes.

## Las trampas ya pagadas

Dieciséis fallos que costaron una tarde cada uno, escritos con su síntoma:
[Las trampas ya pagadas](https://github.com/kittcat-lab/dsh-kitt-voice/blob/main/DOCUMENTACION/TRAPS.es.md). Todos salieron usándolo y
no leyendo el código, y ninguno daba un error. Antes de tocar la parte que le
toca a cada uno, se lee la suya.

## Licencia

MIT — ver [LICENSE](LICENSE). Los proyectos previos consultados están
reconocidos en [NOTICE](NOTICE). Cómo contribuir: [CONTRIBUTING.md](CONTRIBUTING.md).
Cambios: [CHANGELOG.md](CHANGELOG.md).

Hecho por [Kitt Cat](https://kittcat.com) · kittcat.com

English: [README.md](README.md) · 中文: [README.zh.md](README.zh.md)

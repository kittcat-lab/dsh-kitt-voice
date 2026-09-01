# DSH KITT

Voice for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
web interface — built Spanish-first, and usable without the browser in front of
you.

Press a key, say what you want, and the agent answers out loud. A small
companion window floats above whatever you are doing and shows what is
happening.

> **Status: working, early.** The spoken conversation, the companion window
> and the global keys are done and used daily. The interface speaks Spanish,
> English and Simplified Chinese. Local Whisper is not written; see
> [What is missing](#what-is-missing).

## Why another voice plugin

There are already good voice plugins for the harness. Two things none of them
do, and one of them is not a matter of effort:

- **They do not understand Spanish.** Their recognisers are built for Chinese
  and English. `dsh-kitt-voice` uses Whisper, which is genuinely multilingual, and
  Piper for speaking, which has good Spanish voices and runs locally.
- **They stop working the moment the browser loses focus** — because a plugin
  lives inside a web page, and a web page cannot hear a keystroke it was not
  given, nor be seen over a fullscreen game. That is what the companion window
  is for.

## What it does

- **A spoken conversation, not dictation.** Press once and talk. It hears when
  you have finished, transcribes, sends, waits for the reply and reads it back,
  then listens again. No button between one turn and the next.
- **It knows a voice from a noise.** Deciding when you have stopped talking by
  measuring loudness fails in a noisy room — a TV, music, an engine coming out
  of the speakers: every noise reads as speech, and hands-free that means
  sending nonsense to an agent on your behalf. A real detector — Silero — decides instead. Measured
  here with the threshold at 0.30: silence 0.04, engine noise 0.13, a low
  rumble 0.10, a whistle 0.16. The last three, at high volume, would have
  fooled any meter.
- **Push to talk, when you prefer it.** Click the microphone or press your key,
  speak, press again. The text lands in the message box; you decide when to
  send it.
- **Read aloud as it arrives.** In a conversation the reply is spoken sentence
  by sentence while the agent is still writing it, so a long answer does not
  begin with fifteen seconds of silence. A sentence is only spoken once its
  ending has arrived: half a sentence and a pause sounds like a fault. Code
  blocks are named, not spelled out.
- **A voice worth listening to.** 104 neural voices, grouped by language and
  by country: 45 Spanish — Spain and every Spanish-speaking country in the
  Americas — 47 English and 12 Chinese. They are read out by Microsoft's
  read-aloud service, with no key and no account, and **the price is stated
  plainly: the text of the reply leaves your machine.** Nothing else does.
- **At your own pace.** Reading speed is adjustable from half to double, and
  it applies to all three engines: the system voice, Piper and the neural
  ones. Listening is not reading, and a long reply at somebody else's pace is
  hard to follow. Set it from the companion window's menu, no files involved.
- **The conversation rings.** It opens with a rising note and closes with a
  falling one, so you know from the sound alone that it is listening — which
  is exactly when you are not looking at the screen.
- **The interface speaks three languages.** Spanish, English and Simplified
  Chinese, in the page and in the companion window. The window's language is
  chosen in its own menu and is independent of the language you dictate in.
- **Or nothing leaves at all.** Point it at a folder of Piper voices and
  synthesis happens here, offline. And with neither of those, it still speaks
  with the voice the machine already has. It talks from the first minute; the
  better voices are an improvement, not a requirement.
- **Keys that work anywhere.** Assign a global key and talk to the agent from
  whatever application you are in — a game, an editor, anything. A wheel
  button mapped to that key works too.
- **Pick your devices.** Microphone and sound output are chosen separately,
  because the good microphone and the good speaker are rarely the same
  device.
- **It always says what is happening** — listening, transcribing, speaking —
  and when something fails it says which part failed and why.

## Install

```
dsh plugin --profile web add dsh-kitt-voice
```

The command installs the package into the harness profile and appends the
plugin to the profile's bundle list by itself (a dependency that declares
`dsh.bundle` joins the layer stack automatically). Restart the harness — stop
it completely, do not just relaunch, or you keep talking to the old process. A
microphone and a speaker button appear in the composer tool row.

To undo it:

```
dsh plugin --profile web remove dsh-kitt-voice
```

The same command reconciles the bundle list, removing only this plugin. The
old advice to edit `package.json` by hand belongs to an earlier version of the
CLI that rewrote the whole bundle list; the current one reconciles by
installed state.

**From a checkout instead of npm:** point the profile at the clone.

```
dsh plugin --profile web add link:/absolute/path/to/dsh-kitt-voice
```

If your harness runs a different profile name, replace `web` with it.

## Configure

Everything except the transcription key lives in **Settings → Plugins →
dsh-kitt-voice**: recogniser, language, guidance vocabulary, voices folder, voice,
microphone and sound output.

**The transcription key comes from the harness's own credential store** — the
same place the agent's own key lives. Nothing to create, nothing to restart:
store it under `GROQ_API_KEY` and the plugin finds it. Point `apiKeyRef` at a
different name if yours is stored under one.

If there is nothing in the store, `DSH_KITT_API_KEY` or `GROQ_API_KEY` in the
environment are used instead.

The key is never exposed in Settings and never reaches the browser. The page
asks only *whether* one is configured, through a call that cannot return a
value. It is resolved fresh on every request, so replacing a key takes effect
immediately.

### Recognisers

| Option | Account needed | Works inside a desktop shell | Notes |
| --- | --- | --- | --- |
| Browser (default) | no | **no** | Chrome and Edge only; audio passes through the browser vendor |
| Groq Whisper | yes | yes | Best accuracy and speed; needs a key in the credential store |

The browser recogniser is the default so a new user can talk within seconds.
It does not work inside Electron — the object exists there but recognition
fails every time — so when the harness is embedded in a desktop app the plugin
switches to Groq and says so.

### Spanish with English words in it

A Spanish speaker says `setup`, `brake bias`, `understeer` in the middle of
Spanish sentences. Told only "Spanish", Whisper writes them phonetically
(`cetap`, `breik baias`) and the agent receives nonsense. The **guidance
vocabulary** in Settings is sent to Whisper so those terms stay in English.
Edit it for your own field.

## The turn detector

The hands-free conversation has to know when you have finished a sentence.
That is a model — Silero v5 — plus its runtime, and together they are about
sixteen megabytes.

**They are not shipped in this package.** Most people who install a voice
plugin want to press a button and talk; making all of them carry sixteen
megabytes for a mode they may never switch on is rude. So they arrive one of
two ways, in this order:

1. **a folder you already have**, named as `vadDir` in Settings — nothing is
   downloaded;
2. **a guided download**, announced with its size, the first time you switch
   the conversation on.

Either way the files are then served back to the page **by the harness itself**,
so the browser never reaches the internet on its own, and only the six names on
a fixed list can ever become a path.

Six files, not five: the detector's own bundle does not carry the inference
runtime. It expects to find one already on the page, loaded first.

## The companion window

```
cd overlay
start.cmd          Windows
./start.sh         macOS and Linux
```

Electron is not bundled: the harness is a web application and most people will
never want a desktop window. The launcher uses one you already have — set
`DSH_KITT_ELECTRON` to point at it — or `npm install` here to fetch one.

A bar floats above everything, including a fullscreen game, and **the bar is
the controls** — the same ones you get in the harness's own tool row: same
drawing, same colour, same size, because they are the same control in two
places.

- a **red** microphone — press, speak, press again; the text lands in the
  message box and **you send it** with Enter;
- a **blue** speech bubble — KITT mode: hands-free conversation, nothing else
  to press. It turns on and off from either side;
- an **amber** struck-through microphone — **mute**. It stops the detector for
  real, it does not pretend. This is for the moment you are not looking at the
  screen: someone starts talking to you, or you play a video. Muting puts the
  conversation on hold; it does not hang up;
- a **speaker** — hear the last reply again;
- a **gear** — everything else: microphone, speaker, voice, speed, language
  and button colours; the keys; silence and shape;
- an **×** — close the window without opening the menu. Closing is never a
  dead end: the plugin opens it again the moment the voice is used, and the
  gear in the harness tool row opens it whenever you want.

The **border** carries the state, so it can be read out of the corner of an
eye: **nothing at rest, green while it listens — growing with the measured
level of your voice — blue breathing while it thinks, and red while it speaks
to you.** If something fails, the word **ERROR** blinking, which needs no
colour to interpret.

Drag it anywhere by holding it, and it remembers where you left it.

**Keys** (assign them in the menu): `F8` speak and send, `F9` start or end the
conversation, `F7` mute the microphone, `F10` hear the reply again, `F11` be
quiet, `F6` open the menu. To use a wheel button, map it to one of those keys
in your wheel's own software — no gamepad plumbing needed. Keys belonging to
the whole system (Ctrl+C, Alt+F4 and friends) are refused: a global shortcut
takes the key away from every application on the machine.

Set `DSH_KITT_PORT` if your harness is not on 3081. It takes a **port**, never
a URL: the window can only ever address loopback.

## Layout

```
lib/          the plugin
  index.js      host half: settings, HTTP routes, capturing the last reply
  client.js     browser half: the controls, the recording, the settings card
  guard.js      who is allowed to call the routes
  transcribe.js speech to text
  speak.js      text to speech with local Piper voices
  chunk.js      splitting a reply into speakable pieces
  neural.js     the neural voices, and what leaves the machine for them
  overlay.js    opening the companion window when the voice is used
  vad.js        the turn detector's files, and how they get here
  lastfromlog.js recovering the last reply from the session's own log
  apikey.js     resolving the key, per call, never cached
  log.js        one startup line, and refusals — never the key
  freshness.js  detecting a server running an older copy of this plugin
overlay/      the companion window (its own Electron app)
  main.js       the window, its shape and position
  shortcuts.js  system-wide keys
  requests.js   the closed list of what the window may ask the harness
  textos.js     every string the window shows, in the three languages
  index.html    what it draws
test/         the parts worth protecting
```

The two halves never share memory. They speak over thirteen loopback routes
under `/dsh-kitt-voice`: `config`, `settings`, `devices`, `voices`, `transcribe`,
`speak`, `last`, `state`, `command`, `orders`, and `vad/status`,
`vad/download`, `vad/file`. Every one of them checks its caller.
`state` flows page → host → companion; `command` flows the other way, and is
how a key pressed outside the browser reaches the page.

## Security

- **Every route checks its caller.** Loopback is not privacy: any page you
  visit can make your browser send requests to `127.0.0.1`. Requests must
  arrive on loopback, and a request carrying an `Origin` must name this same
  server — same loopback spelling, same port (Origin and Host are both written
  by the caller, so they are never trusted to agree with each other). Refusals
  say nothing about the machine.
- **The transcription key never reaches the browser** and is never logged. The
  page learns only whether one is configured.
- **A voice name cannot become a path.** It is checked against a strict pattern
  before it is joined to a folder.
- **The companion window is locked down**: context isolation on, no Node in the
  page, sandboxed, no navigation, no new windows, no browser permissions, and
  it can only ever address `127.0.0.1` on a configurable port — never a URL it
  was handed. Its page makes no network calls at all: the main process relays
  them against a closed list of paths (`overlay/requests.js`), so the window
  cannot be pointed at any other host even by its own code.
- **A file name cannot become a path either.** The detector's files are served
  by name against a fixed list of six; anything else is refused before a path
  is ever built.
- **Global keys are given back** when the window closes.

## Tests

```
npm test
```

50 tests, run with `node --test`, no build step. They cover the parts where a
mistake is expensive: who may call the routes, whether a voice name can escape
its folder, what the reply splitter promises, that the log fallback never
throws inside the route it exists to help, the window's request allowlist, the
read-aloud sentence splitter and the speed steps.

## What is missing

- **Local Whisper.** It would remove the key requirement inside a desktop
  shell. It needs model management and audio conversion, and is not written.
- **Interrupting by voice.** Possible with headphones, where the microphone
  cannot hear the reply. With open speakers it is not.
- **Anything but Windows.** Nothing here is Windows-only — the voices, the
  window and the keys all have their equivalents — but it has only ever been
  run on Windows. Reports welcome.

## Licence

MIT — see [LICENSE](LICENSE). Prior art and acknowledgements are in
[NOTICE](NOTICE). How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md).
Changes: [CHANGELOG.md](CHANGELOG.md).

Built by [Kitt Cat](https://kittcat.com) · kittcat.com

Español: [README.es.md](README.es.md) · 中文: [README.zh.md](README.zh.md)

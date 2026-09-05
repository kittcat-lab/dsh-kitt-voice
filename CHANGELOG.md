# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-09-05

**The conversation no longer gets stuck, talks to itself, or changes voice
mid-reply — and the keys go to one page only.** Every one of these was found
by using it; none raised an error.

### Fixed

- **A reply that never ended.** Chrome's built-in voice sometimes stops
  mid-utterance without firing `end` or `error`. The read-aloud loop awaited
  that promise forever: the bar stayed red, «be quiet» did nothing, and the
  conversation could not be switched off. Every utterance now has a watchdog
  sized to its text, non-local voices get a keep-alive, and no voice is ever
  handed more than 220 characters at once.
- **It transcribed its own voice.** The detector keeps hearing the reply's
  echo until its own 1.4 s of silence has passed; the ear was reopened 500 ms
  after the audio ended, so the echo's «speech end» arrived on an open ear and
  was sent to the agent as if the person had said it. The detector is now
  paused — which empties it — before the ear reopens.
- **It cut itself off.** The echo floor was measured from the moment the first
  sentence was *requested*, not from when it started to *sound*. With the
  neural voice that is a second of silence, so the floor came out near zero
  and the reply's own echo cleared it. Calibration now starts when audio
  actually plays.
- **«Be quiet» did not.** In a conversation, F11 silenced the current sentence
  and the loop carried on with the next; a piece already being fetched played
  anyway. It now ends the reading and the wait, and a stop requested mid-fetch
  is honoured.
- **Ending the conversation waited for the paragraph to finish.** The blue
  button closed the detector but let the current audio play out. It stops the
  voice first.
- **Two conversations from a double press.** The «already running» check came
  after two awaits. It is now a synchronous flag.
- **A conversation nobody could stop.** Its handle lived in a React ref of the
  microphone button; when the harness re-rendered the tool row the handle was
  lost and the detector kept running. It now lives outside the component.
- **The voice changed mid-reply.** Three causes, all fixed: the engine was
  re-decided per sentence, so one transient failure switched that one sentence
  to the system voice; Chrome's system voice list is empty until
  `voiceschanged` fires, so the first sentence got the default — often
  English — voice; and the server truncated any request over 2000 characters
  without saying so, while Piper timed out on long ones and fell back. Engine,
  voice and rate are now decided once per reply, a failed engine stays failed
  for the rest of that reply (and the status line says so), voices are
  collected ahead of time, and nothing longer than 220 characters is ever
  requested.
- **Closing the companion window did not close it.** With `overlayAuto` on,
  the window was re-launched on *every* active state, so during a conversation
  it came back half a second after the × was pressed, sometimes racing its own
  single-instance lock. It now opens only when the voice goes from idle to in
  use; closed by hand, it stays closed until the next time the voice is
  started, or until the gear asks for it.
- **Deaf after an interruption.** The detector's `pause()` and `start()` are
  asynchronous and were called back to back when a voice cut in: the pause's
  "stop the processor" landed after the start's "resume it", leaving the
  microphone open and the processor stopped — the bar blue, nothing heard,
  and no later start able to fix it. They are now serialised and awaited, and
  a start that fails is reported. The conversation also opens the microphone
  chosen in the menu (and re-opens the same one after every pause) instead of
  the system default.
- **Two pages, one set of keys.** With the harness open in the installed app
  and in a tab, both received every order — two microphones, two sends — and
  the companion window flickered between their states. Each page now
  identifies itself; the harness sends each key to the page that is using the
  voice (or, when none is, the one in front), and only accepts state from it.
- Smaller: a noise while the agent was thinking cleared «Thinking» from the
  screen; an empty transcription left «Listening» stuck on; the dictation key
  pressed during a conversation opened a second microphone (it now says the
  conversation is on instead); the turn detector's download had no time
  limit; a notice such as «read with the built-in voice» was stored but never
  shown; the companion window's menu swallowed every key, so its lists could
  not be moved with the keyboard; a dictation cut short by the tool row
  re-rendering left the microphone open.

### Changed

- **The K is the KITT-mode control.** The companion bar had a red microphone
  and a blue speech bubble side by side — two ways of talking that were easy
  to confuse — and the brand mark opened the website, which was intrusive.
  Now the brand's K, on the left, switches the hands-free conversation on and
  off and lights up blue while it is on; the bubble button is gone; the
  website opens only from the «kittcat.com» text beside it, and only at rest.
  The bar reads, left to right: K, state, then red microphone, speaker, mute,
  gear, close. The harness tool row mirrors it, as it always has.

### Added

- `lib/paginas.js`: which page the keys belong to when more than one is
  open, with 10 tests.
- 9 tests over the splitter that feeds the voices.
- Eight new entries in the traps document, one per fault above.

## [0.2.1] - 2026-09-02

**Fixes a 0.2.0 that does not load at all.** If you installed 0.2.0, the
harness stops with `Failed to load plugins` and the whole plugin is gone — no
microphone, no window, no toolbar. Upgrade.

- `lib/client.js` is served to the browser as a single standalone file, with
  no bundler, and the harness loads it through its own module loader. 0.2.0
  added an `import` of a sibling module to it, and the bundle then loads
  without registering itself. The interruption logic is back inside the client;
  `lib/corte.js` remains as the copy that can be tested outside a browser.
- Three tests now guard that pairing: the two copies must agree on their four
  constants, they must decide identically on the cases that matter, and
  `client.js` must contain no `import` line at all.

Every test passed on the broken build — they import the module directly in
Node, where imports are fine. That is the actual lesson, and it is written down
in the traps document: if the tests do not load the code the way production
loads it, they are not testing that.

## [0.2.0] - 2026-09-02

**You can interrupt it now.** Talking to the agent while it was thinking, or
while it was reading a reply aloud, did nothing at all: the turn detector was
paused the moment a message was sent and did not come back until the whole
reply had been read. On a long answer that is half a minute of deafness. Found
by using it.

- **Echo cancellation is now actually requested.** It never was: the microphone
  was opened bare and the browser left to decide — and it decides differently
  depending on how the device is asked for. Noise suppression and automatic
  gain too, both for the microphone and for the detector, which opens its own.
- **While the agent is thinking, the ear stays open.** Nothing is being spoken
  then, so there is no echo to defend against; it was closed for no reason. It
  now closes when the first word is actually spoken.
- **You can talk over the reply and it stops.** The threshold is not guessed,
  it is measured: for the first half second of every reply the microphone
  listens, and what it hears *is* the echo, because nobody has spoken yet. To
  count as a voice, sound must clear that floor by 3× and hold for a third of a
  second. It adapts itself to headphones or speakers, and re-measures on every
  reply. A door slam or a cough is too short to trigger it.
- **One turn at a time, and the newest wins.** With the ear open, speaking
  could start a second turn on top of the first — two transcriptions, two
  drafts and two sends. Each turn now takes a number; the superseded one may no
  longer write the draft, send, or read aloud.

Eleven new tests over the interruption decision, including the two cases that
would ruin the feature: the echo must not trigger it, and neither must a bang.

## [0.1.2] - 2026-09-01

Documentation only; no change to what the plugin does.

- **The install warning about `msedge-tts` is not a warning under pnpm — it is
  an error, and it fails the whole command.** Since a harness profile uses
  pnpm, this is the case that actually matters, and 0.1.1 only described the
  npm one. pnpm leaves `msedge-tts: set this to true or false` undecided in the
  profile's `pnpm-workspace.yaml`, and until somebody decides, *every* install
  in that profile fails — other people's plugins included. The READMEs now say
  so, with the fix, in all three languages.
- The Chinese version of that note shipped double-encoded in 0.1.1 and was
  unreadable. Repaired.
- Four tests over the published documents: none double-encoded, every relative
  link resolves, the three languages of the traps document link to each other,
  and the pnpm fix appears in all three READMEs rather than only in English.

## [0.1.1] - 2026-09-01

Packaging only; no change to what the plugin does.

- The package description said the name twice — a leftover from the rename.
- The link to the traps document is now absolute. That file is not shipped
  inside the package, so a relative link went nowhere when the README was read
  on npm rather than on GitHub.

## [0.1.0] - 2026-09-01

First public release. Voice for the DeepSeek Harness web UI: talk to the agent
and hear the reply out loud, with a companion window that floats above other
applications and global hotkeys that work while you are somewhere else.

### Added

- **Two ways of speaking**, and they are different: one press, one whole turn
  (push to talk, the text lands in the message box, you send it) and the open
  hands-free conversation that keeps listening until you stop it.
- **Hands-free knows a voice from a noise**: the turn ends on measured silence
  from Silero v5, never on a loudness meter or a timer.
- **Read-aloud as it arrives**: a reply is spoken sentence by sentence while
  the agent is still writing it. Code blocks are named, not spelled out.
- **Three speaking engines**: 104 neural voices from Microsoft's read-aloud
  service (45 Spanish, 47 English, 12 Chinese), local Piper voices, and the
  built-in system voice as the always-available fallback. Nothing is ever
  downloaded on the user's behalf.
- **Reading speed from half to double**, applied to all three engines, set
  from the companion window's menu.
- **Two ring tones**: a rising note when the conversation opens, a falling one
  when it closes, so you can tell from the sound that it is listening.
- **The companion window**: a floating bar that is the controls (speak,
  conversation, menu, close), carries the state in its own colour, drags
  without stretching, and leaves no ghost on screen. Global hotkeys F8-F11,
  assignable in the menu.
- **Interface in three languages**: Spanish, English and Simplified Chinese,
  for the page and for the window (the window's language is chosen
  independently from the language you dictate in).
- **The transcription key never reaches the browser**: it is resolved from the
  harness credential store on every call, never cached, never logged.
- **Every HTTP route checks its caller**: loopback socket plus an Origin that
  must name this same server on this same port. The window's page makes no
  network calls at all; its main process relays against a closed list of paths.
- **The turn detector's files are served by the harness itself** against a
  fixed six-name list; a file name can never become a path.
- 50 tests covering the parts where a mistake is expensive: the guard, voice
  name escaping, the reply splitter, the log fallback, the window's request
  allowlist, the read-aloud sentence splitter and the speed steps.

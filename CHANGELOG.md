# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

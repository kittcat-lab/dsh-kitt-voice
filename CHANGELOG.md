# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

# Traps already paid for

*[Español](TRAPS.es.md) · [简体中文](TRAPS.zh.md)*

Sixteen bugs that cost an afternoon each. **Every one of them turned up by
USING the thing, none by reading the code, and not one of them raised an
error** — which is exactly why they are written down: these are the ones you
cannot find by looking.

Before touching the part a trap belongs to, read that trap. And if one of them
ever comes back, it is a regression, and a regression outweighs a new find.

---

## In the harness and its routes

1. **Cordis will not let you so much as READ a context property you did not
   declare in `inject`.** It does not hand back an empty value: it throws. And
   inside a route that surfaces as a **bare 400, with not a word in it**.
2. **A `prefix` route with a trailing slash matches NOTHING.** The contract says
   "absolute pathname, no trailing slash". With the slash it falls through to
   the fallback 404 — an **empty** 404, indistinguishable from "that file does
   not exist".
3. **How to tell those two apart:** by the status code **and the size**. A
   zero-byte 404 came from the harness; one with JSON in it came from the
   plugin. A 400 with no body is a route that threw.
4. **A dying socket takes the whole harness with it.** A held-open connection
   emits `error` when it closes, and an `error` with no listener does not fail
   the request — it kills the process, **without a line in the log**. Listen for
   it in all four places: `req.close`, `req.error`, `res.close`, `res.error`.

## In the browser page

5. **A background tab has no clock.** Chrome throttles its timers to one a
   second, and after a few minutes to one a MINUTE. Anything that depends on a
   timer **stops working precisely when you need it**, which is when another
   application is in front. So orders are PUSHED from the server down a route
   held open: a network call is not a clock, and nothing throttles it.
6. **A handler that reads render state from the render it was registered in
   swallows orders.** An order arrives from outside, which means it lands in a
   page that may not have re-rendered since. Read the state **at the moment the
   order arrives**. Symptom: works once and never again, silently.
7. **Sending can open a NEW session in the harness.** Holding on to the previous
   id means waiting for a reply that is being delivered somewhere else. Symptom:
   "the agent did not answer" with the answer on screen.
8. **One agent turn is SEVERAL steps.** It thinks, calls a tool, looks at the
   result, and carries on — and each step is a stream that starts and ENDS.
   Taking the first ending for the turn's ending makes you announce no answer
   while it is answering. And each step starts its text **from scratch**, so
   what arrives can be SHORTER than what came before: comparing lengths loses
   whole steps. Compare the text.
9. **Do not put a clock on the agent.** One that goes off to look something up
   takes as long as it takes. Waiting is not a failure, and a window that turns
   red over it teaches you to ignore the colour.

## In the floating window

10. **A transparent always-on-top window smears a shadow across the screen when
    you move it.** It is not two windows — that was insisted on, and it was
    false: it is the desktop not repainting. The cure is two switches, both of
    them **before** the app starts:
    `app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')`
    and `app.disableHardwareAcceleration()`.
    **And the same on SHRINKING**, which is a different case: closing the menu
    takes the window from 480 tall to 44, and what the panel occupied stays
    painted. The two switches do not reach there, because nothing moves —
    surface disappears. Hide it and show it again, which forces a repaint.
11. **A window that does not take focus cannot be dragged** with
    `-webkit-app-region: drag`: Windows never sends it the click. You have to
    follow the pointer from the main process.
12. **A window being dragged GROWS if you read its size.** Reading it and giving
    it straight back sixty times a second, on a display that is not at 100%,
    accumulates a rounding error that only ever goes up: 258×44 to 276×62 and
    climbing. `setPosition` does not help either — measured. The size is imposed
    from a constant and never read back off the window.
13. **The second instance wipes the first one's settings.** Quitting is
    asynchronous: the instance that loses the lock still starts up, fails to
    register shortcuts the other one already holds, and writes that failure —
    four nulls — over the good settings. The keys stop working and nothing says
    so. The instance that loses must touch nothing.
14. **Killing the harness the rough way orphans the window.** The floating
    window is a SEPARATE process: when the harness shuts down properly, it
    closes it. Kill it without letting it tidy up — a `taskkill /F`, a
    `Stop-Process -Force` — and the bar is left alive and alone on screen, with
    nobody to close it and no server to talk to. It is not hung: it is orphaned.
    Close it with its own X. Restarting the harness roughly several times over
    leaves one bar per restart.
15. **A stored null beats the default.** All four shortcuts sat in the window's
    settings file as `null`, and on startup those nulls won against F8–F11: the
    keys did nothing and nothing said so. Filter for what was actually chosen
    before merging it with the factory values.

## On how things are said

16. **"Listening" cannot mean "the microphone is open".** Put that way, the
    screen says "Listening" without pause and whoever reads it understands they
    are being recorded wholesale. It means there is a voice RIGHT NOW. Between
    turns, at rest.

---

## And three about measuring, good for any project

- **A test view that renames the identifiers measures nothing.** The CSS stopped
  reaching it and it produced figures for a design that did not exist. If you
  are measuring, measure the thing as it actually is.
- **Counting with a badly written pattern is worse than not counting.** Nine
  strings were taken for translated because the pattern read any comma inside
  the text as a third translation. There were zero. An invented number
  propagates into everything decided with it.
- **A settings file can be corrupted by rewriting it.** The accents came out
  doubled ("MicrÃ³fono"), the microphone's name stopped matching any device, and
  the application raised no error at all: it simply picked the default device.
  When you touch a file with accents in it, check afterwards by reading it back.

## Closing the ear was right, and closing it there was wrong

**The detector hears itself.** With the microphone open while the reply is
being read aloud, the turn detector picks up the plugin's own voice out of the
speaker, decides it was spoken to, and the thing talks to itself forever. So
the detector was paused, and that was correct.

**It was paused in the wrong place.** It was paused the moment the message was
*sent* — but at that moment nothing has been spoken yet: the agent is
thinking. So the ear was closed for the whole of a think that can run for
several seconds, with no echo whatsoever to defend against. Symptom, found by
using it: you talk to it while it thinks and it is simply deaf. Nothing in the
interface says so, because from the inside nothing is wrong.

The cure is to close it when the **first word is actually spoken**, not when
the message leaves.

**And a second one hiding underneath: echo cancellation was never requested.**
The microphone was opened bare — `getUserMedia({ audio: true })` — and the
browser left to decide. It decides differently depending on how the device is
asked for. In a voice plugin that is not a detail: it is the difference between
being able to talk with the speakers on and not.

**Then, how to interrupt at all without guessing.** A fixed threshold is a bet
about somebody else's room, their volume, their speakers. Bet one way and it
cuts itself off every other sentence; bet the other and it never cuts at all.

So it is not guessed, it is measured. For the first half second of every reply
the microphone listens, and what it hears **is** the echo, by definition:
nobody has spoken yet. That is the floor for this machine, in this room, at
this volume. To count as a voice, sound must clear that floor by 3× and hold
for a third of a second. It re-measures on every reply, so headphones going on
mid-session adapt by themselves.

**And two things that would have made it useless without them:** stopping the
current utterance is not stopping — the reading loop starts the next chunk half
a second later unless it is told to stop too. And the detector has been
recording since it first heard the echo, so unless that buffer is thrown away,
what gets sent for transcription **starts with the plugin's own voice**.

## One that stopped being true

For months it was written here that **`dsh plugin remove` took the profile's
links down with it**, and that you had to edit `package.json` by hand.
Re-measured on 1 Sep 2026 against the installed command's own code: today it
**reconciles the list against what is installed**, so it is no longer true, and
the README says what is true today.

It stays written here as a reminder of the other thing: **a trap expires too**,
and repeating one that no longer happens is as bad as never having written it.

## One that frightens under npm and bites under pnpm

**"A package has install scripts that were not run" is a warning under npm and
an error under pnpm.** The script is `msedge-tts`'s `preinstall`,
`npx only-allow pnpm`: it builds nothing, it is a latch forcing *its own*
contributors onto pnpm, and elsewhere it fails on purpose. Skipping it is not
merely harmless — it is correct.

Under npm that is the end of it: measured on a clean machine, `npm install`
exits 0, the library lists 322 voices and returns real audio, with nothing built
and no local voices installed.

**Under pnpm — which is what a harness profile uses — the same situation fails
the whole command** with `[ERR_PNPM_IGNORED_BUILDS]`. And pnpm does not decide
for you: it writes `msedge-tts: set this to true or false` into the profile's
`pnpm-workspace.yaml` and leaves it there. Until somebody decides, **every**
install in that profile fails — including other people's plugins, so the next
person to hit it has no reason to suspect this one. Set it to `false`.

Found by installing an unrelated plugin into a profile that already had this
one. **A warning in one package manager is not a warning in the next: the same
situation has to be measured in the one people will actually use.**

## The one I wrote down and then walked into anyway

**Reading a UTF-8 file without saying so re-encodes it, and nothing complains.**
A file was read with a tool that defaults to the system codepage, edited, and
written back as UTF-8. The Chinese in it became double-encoded — a wall of
`å…³äºŽ` where the text used to be. No error, no failed command; it simply
shipped, and it was found later by a search that could no longer match its own
heading.

The trap about corrupted settings files was already written three sections
above. Having it written is not the same as reading it. **After touching any
file with accents or non-Latin script, read it back and check** — and if the
check can be a line of code rather than a pair of eyes, make it one.


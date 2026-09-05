# Traps already paid for

*[Español](TRAPS.es.md) · [简体中文](TRAPS.zh.md)*

Twenty-three bugs that cost an afternoon each. **Every one of them turned up by
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


## In the conversation, once in use

17. **The echo outlives the reading.** The detector keeps hearing the echo of
    the last sentence until ITS 1.4 s of silence has passed. Reopening the ear
    half a second after the speaker goes quiet is reopening it before the
    detector has closed that "voice": its end arrives on an open ear, and what
    it carries is the plugin's own reply, which gets transcribed and sent to
    the agent as if the person had said it. Pausing the detector empties it;
    starting it does not. Pause, wait, start.
18. **A system utterance that never ends.** The browser's voice (Chrome)
    stops mid-way through a long utterance and fires neither `end` nor
    `error`. A promise waiting for that end never resolves: the whole loop
    sits waiting, the bar stays red, and neither "be quiet" nor "switch off"
    gets you out. A watchdog per utterance, a pause/resume heartbeat for
    non-local voices, and never more than a couple of hundred characters at
    once.
19. **The echo floor is measured when it SOUNDS, not when it is asked for.**
    Between asking the neural voice for the first sentence and hearing it, a
    second passes. Calibrating in that second is calibrating a silent room:
    the floor comes out near zero, and as soon as the reply starts to sound its
    own echo clears the bar and cuts it. "It stops by itself." The clock starts
    with the first sound.
20. **Silencing one sentence and carrying on with the next is not silence.**
    The quiet key cut the current audio; the reading loop, which never heard
    about it, asked for the next sentence half a second later. And a request
    already in flight when quiet is ordered arrives anyway and plays anyway.
    Quiet is a flag the loop checks between pieces, and a counter that
    whoever is about to play compares before playing.
21. **The "already running" guard has to be synchronous, and the handle
    cannot live in a button.** It was checked after two awaits; two presses
    in a row passed both, and two detectors with two microphones were born. And
    the conversation's handle sat in a React ref of a button the harness
    unmounts and remounts: the handle was lost and the detector kept running
    with no owner. The flag goes before the first await, and the handle
    outside the component.
22. **Two pages are two plugins.** The installed app and a tab both load the
    plugin, both open the order stream and both publish state: every key
    opened two microphones, and the companion window painted one and then the
    other. Somebody has to deal the keys, and it is the server: the page using
    the voice; failing that, the one with focus.
23. **The voice changes by itself when every sentence decides on its own.**
    Three causes together: the engine was decided per sentence, so a network
    hiccup sent THAT sentence to the system voice and the next one back to the
    engine; Chrome's system voice list is empty until it says otherwise, so the
    first sentence came out in the default — often English — voice; and the
    server truncated at two thousand characters without saying so while Piper
    timed out on a long piece and fell back. Engine, voice and rate are decided
    once per reply; a failed engine stays failed until the next, and says so.
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

## The client is served as ONE file, and an import kills the whole plugin

**`lib/client.js` has no imports, and that is not an accident.** It is served
to the browser as a single standalone file — no bundler — and the harness loads
it through its own module loader.

Add one `import` of a sibling file and the harness stops with:

    failed to import loader entry (dsh-kitt-voice): client-modules: bundle
    /plugins/dsh-kitt-voice/client.js loaded without registering
    "dsh-kitt-voice" via __ModuleLoader__.load

**The whole plugin is gone, not just that function** — no microphone, no
window, no toolbar. The harness's own page says "Failed to load plugins" and
nothing points at the import.

This happened by doing the tidy thing: the interruption logic was moved into
`lib/corte.js` so it could be tested without a browser, and imported back.
Every test still passed — they import the module directly in Node, where
imports are fine. It was found by somebody opening the app.

**So the logic lives inside the client, and `lib/corte.js` is a second copy
kept only so it can be tested.** Duplication is bad; duplication with a test
that fails the moment the two drift apart is the only thing that works here.
That test also refuses any `import` line in `client.js` at all.

The lesson is not about this plugin: **a refactor that every test approves can
still be the thing that takes the product down.** If the tests never load the
code the way production loads it, they are not testing that.

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


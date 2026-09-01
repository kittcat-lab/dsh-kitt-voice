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

## One that stopped being true

For months it was written here that **`dsh plugin remove` took the profile's
links down with it**, and that you had to edit `package.json` by hand.
Re-measured on 1 Sep 2026 against the installed command's own code: today it
**reconciles the list against what is installed**, so it is no longer true, and
the README says what is true today.

It stays written here as a reminder of the other thing: **a trap expires too**,
and repeating one that no longer happens is as bad as never having written it.

## One that frightens without biting

**"A package has install scripts that were not run" does not always mean
something is missing.** The warning on install comes from `msedge-tts`, whose
`preinstall` is `npx only-allow pnpm`: it builds nothing, it is a latch the
library uses to force *its own* contributors onto pnpm, and under npm it **fails
on purpose**. So skipping it is not merely harmless — it is correct. Approving
it would break the install rather than fix it.

It was measured before being written down, which is the point: clean install,
`npm install` exits 0, the library lists 322 voices and returns real audio, with
nothing built and not a single local voice installed. **A warning is not a bug —
but neither is it dismissed with "it's probably fine": you check.**

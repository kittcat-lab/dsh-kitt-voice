# Contributing

Thanks for taking the time. This project is small on purpose: a voice plugin
for the DeepSeek Harness, one server half and one browser half. The rules
below keep it that way.

## Reporting a bug

Open an issue and include:

- the harness version (`dsh --version`) and how the harness runs (browser tab,
  embedded desktop shell);
- your operating system and, if it matters, your audio setup (microphone and
  output by name);
- what you did, what you expected, and what happened instead;
- whether the plugin's own status line said anything — the plugin never fails
  silently on purpose, and the words it shows are part of the report.

Please do not include API keys in an issue. The transcription key is read from
the harness credential store and never appears in logs; if you think it leaked
somewhere, say so without pasting it.

## Setting up

```
npm install
npm test
```

The test suite runs with plain `node --test`; there is no build step. The
browser half is served un-compiled as a single file by the harness.

## What lives where

- `lib/` — the server half (ESM). The routes live in `lib/index.js`; who may
  call them is decided in `lib/guard.js`.
- `lib/client.js` — the browser half, one hand-written file in the shape the
  harness expects. It is a known debt that it should be several files; it is
  not split because the harness serves a single browser file and splitting
  would require a build step.
- `overlay/` — the companion window, its own Electron app. `overlay/textos.js`
  holds every string the window shows; `overlay/requests.js` is the closed
  list of what the window may ask the harness.
- `test/` — `node --test` files. Tests protect the expensive parts: who may
  call the routes, whether a voice name can escape its folder, what the reply
  splitter promises.

## Translating

The interface speaks Spanish, English and Simplified Chinese. Strings live in
two places and both are plain lists: `[español, english, 中文]`.

- the page: the `L` block in `lib/client.js`;
- the window: `FRASES` in `overlay/textos.js`.

A missing translation falls back to English and then to Spanish — never to a
blank. When you translate, keep the product tone, keep it brief (buttons and
menu labels are narrow), leave `${...}` placeholders untouched, and use the
same words the harness itself uses in Chinese (会话, 设置, 插件, 权限…): a
plugin that calls things differently from the program that hosts it shows.

When you change the READMEs, update all three (`README.md`, `README.es.md`,
`README.zh.md`) and re-record the hashes in `README.i18n.yaml`:

```
git hash-object README.md README.es.md README.zh.md
```

## Before you open a pull request

- `npm test` passes (it must stay at 50 tests, or more if you added some);
- `node --check` passes on the files you touched in `overlay/`;
- no secrets, no personal paths, no debug leftovers;
- if your change touches a route, the guard, the window's request list or the
  way a name becomes a path, there is a test for it.

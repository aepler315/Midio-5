# Browsers with no file chooser

Why "Browse files" opens the keyboard in Fermata, why no change to this
page can fix that, and what is offered instead.

## The symptom

Open supermaudio.com in Fermata's built-in browser, tap **Browse files**,
and the Android soft keyboard slides up. No file chooser appears. Nothing
is being typed. Tapping again does the same thing.

## The cause

A `WebView` has no file chooser of its own. When a page clicks an
`<input type="file">`, the WebView calls
`WebChromeClient.onShowFileChooser()` and the **host app** is expected to
launch a picker and hand back the chosen URIs. An app that never overrides
that method gets no chooser: the click returns, nothing opens, and the
(visually hidden) input is left as the focused element — so Android raises
the IME for it.

The keyboard is not the bug. It is the residue of a click that went
nowhere.

Fermata is such an app. In
[AndreyPavlenko/Fermata](https://github.com/AndreyPavlenko/Fermata), at
commit `7d2bd42`, `modules/web/.../FermataChromeClient.java` extends
`WebChromeClient` and overrides `onJsAlert`, `onJsConfirm`, `onJsPrompt`,
`onJsBeforeUnload`, `onShowCustomView`, `onHideCustomView`,
`onGeolocationPermissionsShowPrompt`, `onPermissionRequest` and
`onConsoleMessage`. `onShowFileChooser` is not among them, and the strings
`FileChooserParams` and `ValueCallback<Uri[]>` appear nowhere in that
repository.

## Why this is not fixable from the page

Every alternative route a page has to a local file is closed in a WebView:

| Route | Why it does not help |
| --- | --- |
| `<input type="file">` | Needs `onShowFileChooser`, which is absent. |
| `webkitdirectory` on an input | Still an `<input type="file">`; same missing chooser. |
| `showOpenFilePicker()` (File System Access) | Not implemented in Android WebView at all. |
| `fetch('file:///sdcard/...')` | An http(s) page cannot read `file://`. |
| Drag and drop | No drag gesture on a touch screen. |
| Paste a file from the clipboard | Fermata has no way to put a file on the clipboard, and the WebView clipboard does not carry audio blobs. |
| Web Share Target | Requires an installed PWA handled by Chrome; not available inside another app's WebView. |
| Reading Fermata's own media folders | They are internal Android app state. There is no API, and the WebView is not granted them. |

There is also no way to *feature-detect* the problem in advance.
`HTMLInputElement` exists, `type="file"` is supported, `.click()` resolves
without throwing, and no event fires on failure. From script, a WebView
with no chooser is indistinguishable from a player who opened a chooser and
is still looking through it.

## What the page does about it

Two things, in `src/ui/FileChooserProbe.js` and `src/net/UrlAudioSource.js`.

### 1. Detect the dead click, once, and stop repeating it

Since it cannot be feature-detected, it is detected by consequence. Opening
a real chooser is a separate activity: the page loses focus, or becomes
hidden, or gets a `change`/`cancel` event when the player is done. A
chooserless WebView produces none of those — it only focuses the input. So
the probe clicks, waits 1200ms, and then asks one question: **is our input
still the focused element?**

That last clause carries the weight. A slow chooser and a missing chooser
both produce silence; only the missing one leaves *our* input focused,
because a real chooser takes focus out of the document entirely. Without
it, every unhurried person would be told their browser is broken.

On a verdict of "absent" the input is blurred, which is what lowers the
Android IME (there is no API for the keyboard itself), and the verdict is
remembered in `localStorage`. From then on the button is not clicked at
all — which is the actual fix for "the button opens the keyboard".

### 2. Offer a URL instead

`loadAudioFiles()` in `main.js` needs objects with `name`, `size` and
`arrayBuffer()`. That is exactly a `File`, so a fetched blob wrapped as one
plays, analyses and caches identically to a dropped file and nothing
downstream of the picker changes.

Point the field at a song and it plays. Point it at a folder and the page
lists what is in it — a JSON listing or an ordinary HTML directory index,
with subfolders navigable. That is the part that answers "let me *see* my
files" rather than "let me type a path".

## Making it actually work on a phone

Two constraints decide the setup, and both are easy to trip over.

### Loopback, not the LAN

supermaudio.com is served over https, and an https page may not load
`http://` subresources. The one carve-out is **loopback**: `127.0.0.0/8`,
`localhost` and `[::1]` are "potentially trustworthy" origins and are not
treated as mixed content.

So `http://127.0.0.1:8088/` is readable from the https page, and
`http://192.168.1.50:8088/` is **blocked** — the request never leaves the
browser. `classifyUrl()` refuses a LAN address up front and says why,
rather than letting the fetch fail opaquely.

This is why the feature is useful on a phone rather than academic: Fermata
runs on the phone, the music is on the phone, so the server is on loopback.

### CORS, which most simple servers omit

A page can only read a cross-origin response if the server sends
`Access-Control-Allow-Origin`. `python3 -m http.server` does not. Neither
do most Android file managers' "share over HTTP" features. Their bytes
arrive and are then unreadable, and `fetch` reports that identically to a
refused connection — by design, so a page cannot probe the network. Since
a missing header is overwhelmingly the likeliest cause for a local server,
that is the cause the error message names first.

`tools/music-server.mjs` is a minimal server that sends the header, serves
a JSON listing, supports range requests, and is read-only and confined to
one directory. Under Termux (`pkg install nodejs`):

```
node tools/music-server.mjs ~/Music
# then load http://127.0.0.1:8088/ in the page
```

It binds loopback by default, so nothing is exposed to the network. It has
no authentication — do not bind it to a public interface.

### Or just use Chrome

Chrome on Android implements a chooser. Opening the page there instead
needs none of the above. On a head unit, where Fermata's browser is the
only one available, it is not an option — which is what the rest of this
document is for.

## The real fix is upstream

All of this is a workaround for about thirty lines missing from one file in
another project. `docs/fermata-upstream-issue.md` is a bug report ready to
file against Fermata; if it lands, `<input type="file">` starts working
there and the URL loader becomes a convenience rather than the only way in.

## Tests

- `test/fileChooserProbe.test.js` — the detection logic, including the
  slow-chooser case that must not be mistaken for a missing one.
- `test/urlAudioSource.test.js` — the loopback carve-out, what counts as
  audio, listing parsing, and the fetch error messages.
- `tools/url-load-smoke.mjs` — reproduces the chooserless WebView in real
  Chromium by patching `HTMLInputElement.prototype.click`, then checks that
  the keyboard is dismissed, the dead button is never pressed twice, and a
  song reaches the decoder. Run it with `npm start` and a music server up:

  ```
  node tools/music-server.mjs <folder with audio> &
  npm run test:urlload -- http://127.0.0.1:8080 http://127.0.0.1:8088/
  ```

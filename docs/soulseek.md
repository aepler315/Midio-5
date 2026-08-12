# Soulseek song search

Midio can search for songs and load them straight into the show.

## How it works

The title screen has a **Find a song** panel. Search results come from one of
three backends (first match wins):

| Mode | When | What it talks to |
| --- | --- | --- |
| **slskd** | UI config or `SLSKD_URL` + `SLSKD_API_KEY` | Your [slskd](https://github.com/slskd/slskd) instance (recommended) |
| **direct** | UI config or `SLSK_USER` + `SLSK_PASS` | Soulseek network via [`slsk-client`](https://www.npmjs.com/package/slsk-client) |
| **demo** | Default / no credentials | Free & public-domain catalog (Satie, Bach, SoundHelix, …) |

Hitting **Play** downloads the file through the Midio server
(`/api/soulseek/download`) and feeds it into the same path as a drag-and-drop.

## Connect slskd (recommended)

1. Run [slskd](https://github.com/slskd/slskd) with a Soulseek account and an API key.
2. In Midio, open **Connect** on the title search panel.
3. Choose **slskd**, enter the URL (e.g. `http://127.0.0.1:5030`) and API key, **Save**.

Or start Midio with env vars:

```sh
export SLSKD_URL=http://127.0.0.1:5030
export SLSKD_API_KEY=your-key-here
# optional: folder where slskd writes completed downloads (for Play → load)
export SLSKD_DOWNLOADS=/path/to/slskd/downloads
npm start
```

> **Play from slskd:** Midio enqueues the transfer on your slskd. To stream the
> finished file into the browser, point `SLSKD_DOWNLOADS` at slskd’s completed
> downloads directory (same machine). Otherwise drop the file from slskd
> manually once it finishes.

## Direct Soulseek login

```sh
export SLSK_USER=yourname
export SLSK_PASS=yourpass
npm start
```

Or enter credentials in the Connect panel. Uses `slsk-client` inside the
Node server (not in the browser).

## API surface (local server)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/soulseek/status` | Active backend + note |
| `POST` | `/api/soulseek/config` | Set backend (`mode`: `demo` \| `slskd` \| `direct`) |
| `DELETE` | `/api/soulseek/config` | Clear runtime config → demo |
| `POST` | `/api/soulseek/search` | `{ "query": "…" }` → `{ id, mode }` |
| `GET` | `/api/soulseek/search/:id` | Poll results |
| `POST` | `/api/soulseek/download` | `{ item }` → audio bytes |
| `GET` | `/api/soulseek/demo` | List demo catalog |

## Copyright

Soulseek is a peer-to-peer network. **Only download files you have the right
to use.** The built-in demo catalog is free / public-domain / demo-permitted
audio so you can try Midio without an account.

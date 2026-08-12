# Soulseek song search

Midio can search for songs and load them straight into the show.

## How it works

The title screen has a **Find a song** panel. **Soulseek login is the default** —
enter your account under **Sign in**. Results show **Title · Artist · Album · Length**,
parsed from each peer’s folder tree (and filled in via [MusicBrainz](https://musicbrainz.org/)
when a field is missing).

Duplicate files of the *same version* are collapsed to the best peer (bitrate / free
slot / FLAC). **Distinct versions stay** — instrumental, remix, live, acoustic, radio
edit, etc. each appear once. Remasters collapse into the original.

| Mode | When | What it talks to |
| --- | --- | --- |
| **Soulseek login** (default) | UI credentials or `SLSK_USER` + `SLSK_PASS` | Soulseek network via [`slsk-client`](https://www.npmjs.com/package/slsk-client) |
| **slskd** | UI config or `SLSKD_URL` + `SLSKD_API_KEY` | Your [slskd](https://github.com/slskd/slskd) instance |
| **demo** | Explicit choice only | Free SoundHelix catalog |

Hitting **Play** downloads through the Midio server (`/api/soulseek/download`) and
feeds the same path as a drag-and-drop.

## Sign in (default)

1. Open **Sign in** on the title search panel (shown automatically when logged out).
2. Keep **Soulseek login (default)** selected.
3. Enter username + password → **Save & connect**.

Or:

```sh
export SLSK_USER=yourname
export SLSK_PASS=yourpass
npm start
```

## slskd (alternate)

1. Run [slskd](https://github.com/slskd/slskd) with a Soulseek account and API key.
2. In Midio **Account**, choose **slskd server**, enter URL + API key, **Save & connect**.

```sh
export SLSKD_URL=http://127.0.0.1:5030
export SLSKD_API_KEY=your-key-here
export SLSKD_DOWNLOADS=/path/to/slskd/downloads   # so Play can load completed files
npm start
```

## Metadata

| Field | Source |
| --- | --- |
| **Title** | Filename (track number stripped) + version tags |
| **Artist** | Parent folders (`Artist/Album/track`) or `Artist - Title` filename |
| **Album** | Folder above the file (disc folders skipped) |
| **Length** | Peer attributes, or size÷bitrate estimate, or MusicBrainz |

## API surface (local server)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/soulseek/status` | Active backend + `needsLogin` |
| `POST` | `/api/soulseek/config` | Set backend (`mode`: `direct` \| `slskd` \| `demo`) |
| `DELETE` | `/api/soulseek/config` | Clear runtime config → direct (needs login) |
| `POST` | `/api/soulseek/search` | `{ "query": "…" }` → `{ id, mode }` |
| `GET` | `/api/soulseek/search/:id` | Poll results (deduped, with meta) |
| `POST` | `/api/soulseek/download` | `{ item }` → audio bytes |
| `GET` | `/api/soulseek/demo` | List demo catalog |

## Copyright

Soulseek is a peer-to-peer network. **Only download files you have the right
to use.** The demo catalog is free / demo-permitted audio for trying Midio offline.

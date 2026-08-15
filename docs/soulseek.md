# Song search (free music + Soulseek)

Midio’s **Find a song** panel works with **zero setup**. Free music is the
default — no accounts, no API keys. Soulseek is an optional upgrade.

## What players see

1. Type a song / artist → **Search**
2. Results show **Title · Artist · Album · Length**
3. Hit **Play** — the track loads into the same path as a drag-and-drop

Same version of a track is shown once (best quality). Instrumentals, remixes,
lives, etc. stay as separate rows.

| Source | When | Needs |
| --- | --- | --- |
| **Free music** (default) | Always | Nothing |
| SoundHelix demos | Always | Nothing |
| Internet Archive open audio | Free search | Nothing (no API key) |
| **Soulseek via slskd** | `docker compose up -d slskd` + optional login | Soulseek account only |
| **Direct Soulseek** | Connect panel | Soulseek username + password |

## Free music (default)

No sign-in. Search hits a small curated demo catalog plus
[Internet Archive](https://archive.org) open audio. Perfect for trying Midio
or playing when you don’t want network P2P.

## Bundled slskd (recommended for Soulseek)

The repo ships a ready-to-run [slskd](https://github.com/slskd/slskd) config.
API keys are **pre-shared between Midio and slskd** — players never paste one.

```sh
# optional: put your Soulseek account in .env (see .env.example)
cp .env.example .env   # then edit SLSK_USER / SLSK_PASS

docker compose up -d slskd
npm start
```

- slskd UI: http://127.0.0.1:5030 (user/pass `midio` / `midio` for the web UI only)
- Midio auto-detects `http://127.0.0.1:5030` with key `midio-local-dev-key`
- Finished downloads land in `data/slskd-downloads/` (shared volume)

Files:

| Path | Purpose |
| --- | --- |
| [`docker-compose.yml`](../docker-compose.yml) | slskd service |
| [`slskd/slskd.yml`](../slskd/slskd.yml) | fixed local API key + dirs |
| [`.env.example`](../.env.example) | optional Soulseek creds |

## Optional: Soulseek login in the game

Open **Soulseek** on the title search panel → enter username + password →
**Connect Soulseek**. That uses the direct client (or your auto-detected slskd).

Advanced → slskd: only if you run slskd on another host. Leave the API key
blank to use the bundled local key.

Env overrides (server):

```sh
export SLSK_USER=yourname
export SLSK_PASS=yourpass
# or custom slskd:
export SLSKD_URL=http://127.0.0.1:5030
export SLSKD_API_KEY=midio-local-dev-key
export SLSKD_DOWNLOADS=./data/slskd-downloads
npm start
```

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/soulseek/status` | Active backend + `slskdReady` / `freeSearch` |
| `POST` | `/api/soulseek/config` | Set backend (`free` \| `direct` \| `slskd`) |
| `DELETE` | `/api/soulseek/config` | Clear → free |
| `POST` | `/api/soulseek/search` | `{ "query": "…" }` |
| `GET` | `/api/soulseek/search/:id` | Poll results |
| `POST` | `/api/soulseek/download` | `{ item }` → audio bytes |
| `GET` | `/api/soulseek/demo` | Free catalog snapshot |

## Copyright

- **Free results**: open / demo-permitted audio.
- **Soulseek**: peer-to-peer. **Only download files you have the right to use.**

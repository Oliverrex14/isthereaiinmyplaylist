# 🎵 Is There AI In My Playlist?

A web application that scans public playlists from **Spotify**, **Apple Music**, and **YouTube / YouTube Music** to detect AI-generated songs.

## ✨ Features

1. **Multi-Platform Support (No API Keys Required):**
   - **Spotify** (`open.spotify.com/playlist/...`)
   - **Apple Music** (`music.apple.com/.../playlist/...`)
   - **YouTube & YouTube Music** (`youtube.com/playlist?list=...`)
2. **4-Layer AI Detection Engine:**
   - **Keywords & Generator Signatures:** Detects traces of *Suno, Udio, RVC v2, Kits.ai, Boomy, Riffusion, AIVA*, and tags like *AI Cover / AI Generated*.
   - **Known AI Artists Database & Community Reporting:** Includes confirmed AI and "ghost" projects (e.g. *The Velvet Sundown, Breezeway Cocktail, Endel, AIVA, Ghostwriter977*) with built-in community reporting directly from the UI.
   - **Artist History & Release Velocity Verification (Deezer + Apple iTunes API):** Checks the artist's earliest release year (whether they existed prior to the 2023+ generative AI boom), fanbase size, single/album release cadence, and copyright/distributor records (`℗ / ©`).
   - **Audio Preview & Duration Analysis:** Flags typical AI model generation duration windows (2:00 / 4:00) and measures spectral byte entropy on available audio preview streams.

## 🚀 Getting Started

```bash
cd ~/Desktop/Prg/isthereaiinmyplaylist
npm start
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

## ⚖️ Legal, Disclaimers & Licensing

- **Code License:** [MIT License](LICENSES.md) © 2026 Oliver Tobiášek.
- **Trademarks:** Spotify®, Apple Music®, YouTube™, Deezer®, and MusicBrainz® are trademarks or registered trademarks of their respective owners. Their use on this website is strictly for nominative descriptive fair use to identify public playlist compatibility. This project is an independent research forensics tool not affiliated with or endorsed by any platform.
- **Forensics Heuristics Disclaimer:** AI risk metrics and anomaly flags are heuristic estimates provided for informational and educational research. They do not constitute a legal certification of non-human authorship or copyright status.
- **GDPR & Privacy:** 100% cookieless architecture. All web fonts (Inter, JetBrains Mono, Space Grotesk) are self-hosted locally without making external calls to Google Fonts servers.
- **Full Legal Breakdown:** See **[LICENSES.md](LICENSES.md)** for complete details and artist dispute/takedown processes.

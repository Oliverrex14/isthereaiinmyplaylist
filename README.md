# 🎵 Is There AI In My Playlist?

Webová aplikace pro detekci AI-generovaných písniček ve veřejných playlistech na **Spotify**, **Apple Music** a **YouTube / YouTube Music**.

## ✨ Co aplikace umí?

1. **Podpora 3 hlavních platforem (bez nutnosti API klíčů):**
   - **Spotify** (`open.spotify.com/playlist/...`)
   - **Apple Music** (`music.apple.com/.../playlist/...`)
   - **YouTube & YouTube Music** (`youtube.com/playlist?list=...`)
2. **4vrstvá detekce AI skladeb:**
   - **Klíčová slova a tagy:** Hledá stopy po generátorech *Suno, Udio, RVC v2, Kits.ai, Boomy, Riffusion, AIVA* nebo štítky *AI Cover / AI Generated*.
   - **Databáze známých AI interpretů & komunitní hlášení:** Obsahuje známé AI a „ghost“ projekty (např. *The Velvet Sundown, Breezeway Cocktail, Endel, AIVA, Ghostwriter977*) s možností přidávat další přímo z webu.
   - **Ověření historie a legitimity interpreta (Deezer + Apple iTunes API):** Kontroluje rok prvního vydání (zda interpret existoval před érou generativní AI v roce 2023), velikost fanouškovské základny, frekvenci vydávání singlů a licenční/copyright záznamy (`℗ / ©`).
   - **Analýza audio ukázky a stopáže:** Kontroluje typická časová okna AI generátorů a u dostupných audio preview počítá spektrální entropii streamu.

## 🚀 Jak spustit

```bash
cd ~/Desktop/Prg/isthereaiinmyplaylist
npm start
```

Aplikace poběží na adrese: **[http://localhost:3000](http://localhost:3000)**

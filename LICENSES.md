# Licenses, Copyright & Legal Disclaimers

**Project:** `isthereaiinmyplaylist`  
**Author & Maintainer:** Oliver Tobiášek  
**Live Site:** [https://isthereaiinmyplaylist.tech](https://isthereaiinmyplaylist.tech)  
**Repository:** [https://github.com/Oliverrex14/isthereaiinmyplaylist](https://github.com/Oliverrex14/isthereaiinmyplaylist)  

---

## 1. Project Code License

The original source code of **isthereaiinmyplaylist** is open source and licensed under the **MIT License**.  
The official license text is also provided in the root [LICENSE](LICENSE) file.

```text
MIT License

Copyright (c) 2026 Oliver Tobiášek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. Third-Party Software, APIs & Services

The application interacts with third-party web services and public APIs under nominative fair use and respective developer terms:

| Component / Service | Provider / Author | License / Terms | Commercial Use | Purpose / Notes |
| :--- | :--- | :--- | :---: | :--- |
| **@vercel/analytics** | Vercel Inc. | Apache-2.0 | ✅ | Cookieless, privacy-friendly site telemetry |
| **Spotify Accounts & Web API** | Spotify AB | Spotify Developer Terms | ✅ | User authentication (OAuth 2.0) and public catalog metadata |
| **Google Identity Services** | Google LLC | Google APIs Terms of Service | ✅ | User authentication (OAuth 2.0) |
| **YouTube Data / InnerTube** | YouTube LLC / Google LLC | YouTube Terms of Service | ✅ | Public playlist fetching & track identification |
| **MusicBrainz API** | MetaBrainz Foundation | CC0 1.0 Universal / Open Data | ✅ | Canonical open music catalog & ISRC verification |
| **iTunes / Apple Search API** | Apple Inc. | Public Web API Terms | ✅ | Public metadata inspection & audio preview streams |
| **Deezer Public API** | Deezer S.A. | Public Web API Terms | ✅ | Public artist history & audio preview streams |
| **Cloudflare & RESTful Cloud** | Cloudflare Inc. / api.restful-api.dev | Public API Terms | ✅ | Distributed global synchronization for community flags |

---

## 3. Typography & Self-Hosted Fonts

All web fonts used on `isthereaiinmyplaylist` are **100% self-hosted locally** from the `/fonts/` directory.  
**No requests are made to external Google Fonts servers**, ensuring complete GDPR compliance and eliminating third-party IP address leakage (in line with European data protection standards and the Munich Regional Court ruling on remote fonts).

| Font Family | Author / Creator | License | Self-Hosted Location |
| :--- | :--- | :--- | :--- |
| **Inter** | Rasmus Andersson & The Inter Project Authors | SIL Open Font License 1.1 | `/public/fonts/inter-*` |
| **JetBrains Mono** | JetBrains s.r.o. | SIL Open Font License 1.1 / Apache 2.0 | `/public/fonts/jetbrains-mono-*` |
| **Space Grotesk** | Florian Karsten | SIL Open Font License 1.1 | `/public/fonts/space-grotesk-*` |

Full texts of the SIL Open Font License 1.1 are available in the respective upstream repositories.

---

## 4. Trademark Notice & Nominative Fair Use

- **Spotify®** is a registered trademark of Spotify AB.
- **Apple Music®** and **iTunes®** are registered trademarks of Apple Inc.
- **Google®**, **YouTube™**, and **YouTube Music™** are trademarks or registered trademarks of Google LLC.
- **Deezer®** is a registered trademark of Deezer S.A.
- **MusicBrainz®** is a registered trademark of the MetaBrainz Foundation.
- **Vercel®** is a registered trademark of Vercel Inc.
- **Suno™** is a trademark of Suno, Inc.
- **Udio™** is a trademark of Uncharted Labs, Inc.

### Nominative Fair Use Declaration:
Any use of third-party trademarks, service marks, logos, or brand names on this website is solely for **nominative descriptive purposes** (to identify playlist platform compatibility, catalog references, and public data sources).  

**isthereaiinmyplaylist is an independent research, forensics, and consumer transparency tool.**  
It is **not** endorsed, sponsored, affiliated with, certified, or in any way officially connected with Spotify AB, Apple Inc., Google LLC, Deezer S.A., or any of their subsidiaries or affiliates.

---

## 5. Forensics Heuristics & AI Detection Disclaimer

1. **Heuristic Nature of Results:**  
   The scores, flags, and risk indicators generated by `isthereaiinmyplaylist` are algorithmic estimations derived from multi-vector forensics:
   - Release frequency and catalog velocity anomalies (e.g. hundreds of releases over short periods),
   - Metadata presence/absence in canonical registries (e.g. MusicBrainz ISRC verification),
   - Acoustic frequency telemetry (e.g. ultrasonic spectral cutoff filters, stereo phase artifacts characteristic of latent diffusion / transformer models),
   - Aggregated community and third-party synthetic music directories (Soul Over AI, Spotify AI Blocker DB, Community Flag Registry).

2. **No Legal Certification:**  
   Detection outputs are provided strictly for **informational, educational, and research purposes**. They do **not** constitute a definitive legal certification of synthetic generation, copyright infringement, or non-human authorship. False positives and false negatives may occur.

3. **Limitation of Liability:**  
   The maintainer and contributors assume no liability for decisions made or actions taken based on analysis results.

---

## 6. Notice, Dispute & False-Positive Removal Policy

We are committed to fairness and accuracy for human artists, songwriters, session musicians, and independent labels.  
If your music, track, or artist profile has been flagged as synthetic/AI-generated in error (false positive):

1. **Email our review desk:**  
   Send an email to **`dispute@isthereaiinmyplaylist.tech`** (or **`tobiasek.oliver@gmail.com`**) with the subject:  
   `[False Positive Review Request] Artist Name - Track Title`.
2. **Provide verification details:**  
   - Direct link to the track / artist profile (Spotify, Apple Music, or YouTube),
   - Brief proof or context of human composition/production (e.g., session screenshots, raw stems, live performance video, official ISRC registration, or distributor details).
3. **Turnaround:**  
   Reviews are processed promptly (typically within 48 hours). If human authorship is verified, the profile will be explicitly added to our verified human whitelist and cleared across all heuristic models.

---

## 7. Privacy Policy & GDPR Transparency

- **Cookieless by Default:** General visitors are completely untracked. We do not use third-party advertising cookies, marketing cookies, or cross-site profiling trackers.
- **Secure OAuth 2.0 Authentication:**
  - When you sign in with Spotify or Google, authentication occurs directly on Spotify's or Google's secure OAuth servers.
  - We **never** ask for, receive, or store your passwords or private credentials.
  - We only store an encrypted, `HttpOnly` session cookie (`isthereai_session`) to keep you logged in.
  - You can instantly terminate your session and delete your local session cookie at any time using the **Log Out** button.
- **No Personal Catalog Mining:** We do not index or store your private playlists or personal listening history. Only the specific playlist URL you submit is analyzed in transient serverless memory.
- **Privacy-Preserving Telemetry:** Anonymized, cookieless usage metrics are collected via Vercel Web Analytics without collecting personally identifiable information (PII) or storing raw IP addresses.
- **Zero Third-Party CDN Font Leaks:** All typography is served directly from our own domain.

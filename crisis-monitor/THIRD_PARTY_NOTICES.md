# Third-party notices

## OSIRIS

Several backend modules were adapted or ported from
[OSIRIS](https://github.com/simplifaisoul/osiris) (osirisai.live), an
open-source project by [simplifaisoul](https://github.com/simplifaisoul),
under the MIT License below. The affected files carry their own comment
noting exactly what was reused and what was changed:

- `crisis-monitor/backend/src/lib/sanctions.ts` — OFAC/OpenSanctions lookup, adapted
- `crisis-monitor/backend/src/lib/chainIntel.ts` — on-chain wallet intelligence, adapted (optional key-based deepening removed)
- `crisis-monitor/backend/src/lib/telegram.ts` — public Telegram channel-page parser, ported verbatim
- `crisis-monitor/backend/src/lib/osintFeed.ts` — merged Telegram/wire OSINT feed, adapted (no stealth-fetch identity spoofing, no Nominatim geocoding)
- The `LIVE_BROADCASTS` list in `crisis-monitor/backend/src/routes/liveLayers.ts` — verified live-YouTube-broadcast roster, reused as-is

Deliberately **not** reused from OSIRIS: its "RECON Toolkit" (port
scanning / DNS / WHOIS / SSL / vulnerability scanning — active
reconnaissance tooling, out of scope regardless of license), its CCTV
aggregation (built on scraping and an identity-spoofing `stealthFetch`
helper used to evade upstream rate-limiting and bot detection), and that
same `stealthFetch` pattern generally.

```
MIT License

Copyright (c) 2026 simplifaisoul

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

## Geography data used by the escalation pipeline

- **Country borders** (`backend/src/data/africaShapes.json`) — derived from
  [Natural Earth](https://www.naturalearthdata.com/) 1:50m admin-0 data via the
  [`world-atlas`](https://github.com/topojson/world-atlas) package. Natural
  Earth is in the public domain.
- **Populated places** (`backend/src/data/africaPlaces.json`) — derived from
  the [GeoNames](https://www.geonames.org/) `cities1000` gazetteer via the
  [`all-the-cities`](https://github.com/zeke/all-the-cities) package. GeoNames
  data is licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Place lookups at run time** (`backend/src/lib/geocoder.ts`) — place names
  not found in the two files above are looked up through
  [Nominatim](https://nominatim.org/), whose data is © OpenStreetMap
  contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright).
  Lookups are cached permanently and kept within Nominatim's usage policy.

Both data files are regenerated with `backend/scripts/buildGeoData.mjs`.

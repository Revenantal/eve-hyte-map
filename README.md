# EVE Killmap Display

Single-app EVE Online kill activity display that ingests zKillboard R2Z2, keeps one hour of node-based activity in memory, and renders a passive 1:2 canvas display over SSE.

## Requirements

- Node.js 20+ with native `fetch`
- A non-empty R2Z2 `User-Agent`

## Run

```bash
npm install
npm start
```

Copy `config/local.example.json` to `config/local.json` first if you want local overrides.

Open `http://localhost:3000/` or embed `/display` in an iframe.

You can override the display shape per URL with query params such as
`/display?aspectRatio=1:2.05&widthPx=1030`.

## Configuration

Default settings live in `config/default.json`. Optional overrides can come from:

- `config/local.json`
- `config.local.json`
- `EVE_KILLMAP_CONFIG=/path/to/custom.json`
- environment variables such as `PORT`, `R2Z2_USER_AGENT`, `R2Z2_BASE_URL`, `R2Z2_SEQUENCE_URL`, `R2Z2_SEQUENCE_FILE`, `R2Z2_REQUEST_DELAY_MS`, `R2Z2_EMPTY_DELAY_MS`, `R2Z2_RETRY_MS`, `R2Z2_TIMEOUT_MS`, `R2Z2_MAX_CONSECUTIVE_MISSING_BEFORE_SKIP`, `R2Z2_MAX_CONSECUTIVE_RETRY_BEFORE_SKIP`, `R2Z2_HEADERS_JSON`, `DISPLAY_ASPECT_RATIO`, `DISPLAY_WIDTH_PX`, `DISPLAY_MAX_RECENT_KILLS`, `DISPLAY_ACTIVITY_WINDOW_MS`, `DISPLAY_PULSE_DURATION_MS`, `MAP_SYSTEMS_PATH`, `MAP_EDGES_PATH`, `MAP_REGIONS_PATH`, and `HEATMAP_TIERS_JSON`

The app fails fast if `r2z2.userAgent` resolves to an empty string.

## Static Map Data

The committed files in `data/` are compact K-space + Pochven map assets:

- `systems.json`
- `edges.json`
- `regions.json`

They were generated from the official CCP SDE JSON Lines export. To regenerate them locally:

```bash
curl -L https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip -o sde.zip
mkdir -p sde-extract
tar -xf sde.zip -C sde-extract mapSolarSystems.jsonl mapStargates.jsonl mapRegions.jsonl
npm run generate:map
```

`runtime/r2z2-sequence.json` is created and updated automatically at runtime.

## API

- `GET /api/bootstrap` returns initial config, map, and in-memory state.
- `GET /events` streams `kill` SSE events.
- `GET /health` returns liveness plus current sequence, SSE client count, and ingest diagnostics such as the target sequence, last processed sequence, retry counters, and the last skip/error details.

## Testing

```bash
npm test
```

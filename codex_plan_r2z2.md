# Codex Build Plan: EVE Killmap Display (R2Z2 Only)

## Goal

Build a **single deployable app** that displays live EVE kill activity for a fixed-ratio side panel display.

The UI should be optimized for:
- **fixed 1:2 aspect ratio**
- approximately **1000px width**
- passive viewing inside an **iframe**
- **low browser resource usage**
- fast updates on new kill events

The display should show:
- a **2D universe map** rendered with **Canvas**
- **system dots** connected by **lines**
- **region labels only**
- a **heat/activity layer** representing kill activity in the **past hour**
- a **ping/pulse** when a new kill happens in a system
- a **last 3 kills list** below the map
- the list must include at least **ISK value**

This app will use **zKillboard R2Z2 as its only upstream feed source**. Do not build support for alternate feed transports or providers in v1.

R2Z2 is an ordered sequence of JSON files, with a starting sequence available from `sequence.json`, strict monotonic `sequence_id` values, local consumer-side filtering, at least 24 hours of ephemeral retention, a recommended minimum 6-second wait after a 404, and a rate limit of 20 requests per second per IP. A non-empty `User-Agent` is required to avoid Cloudflare blocking. citeturn815216view0

---

## Product Requirements

### Core behavior
1. Render a static 2D EVE universe map.
2. Show systems as dots.
3. Show system connections as lines.
4. Show **region labels only**. Do **not** label systems.
5. When a new kill arrives:
   - append it to recent history
   - update that system's past-hour activity state
   - redraw the map
   - animate a short pulse on the system
   - update the "last 3 kills" list
6. Heat/activity should represent kills in the **last 60 minutes**.
7. Heat/activity should also decay correctly when kills age out, even if no new kill arrives:
   - do **not** use a constant redraw loop
   - instead, schedule redraws only at the exact next expiration time of tracked activity
8. Browser should stay mostly idle when no events are occurring.

### Layout
- Fixed aspect ratio: **1:2**
- Expected width: about **1000px**
- Map occupies top portion
- Last 3 kills list occupies bottom portion
- Designed for dark display mode
- Intended to be embedded in an iframe

### Deployment
- One app containing:
  - backend R2Z2 ingestion
  - frontend static assets / display page
  - config loading
  - sequence persistence
- Easy to run locally and easy to deploy to a small VM or container.

---

## Technical Recommendations

### Stack
Use:
- **Node.js** backend
- **Express** for HTTP server
- **Server-Sent Events (SSE)** from backend to frontend
- **Vanilla HTML/CSS/JS** frontend
- **Canvas 2D** for map rendering
- plain HTML for the kill list

Do **not** use React or Next.js for v1.

Reasoning:
- This is a passive real-time display, not a multi-page application.
- Minimal bundle size and low runtime overhead are preferred.
- SSE is simpler and lighter than WebSocket for one-way updates to the browser.

---

## Architecture

```text
zKillboard R2Z2
    -> R2Z2 sequence ingestor
    -> backend normalization
    -> in-memory activity store + recent kills store
    -> SSE endpoint
    -> browser display page
```

### App responsibilities

#### Backend
- connect to **R2Z2 only**
- fetch starting sequence from persisted state or `sequence.json`
- fetch sequence files in order
- normalize incoming R2Z2 payloads into one internal event shape
- maintain rolling one-hour activity state by system
- maintain latest 3 kills for UI
- persist current sequence safely
- expose:
  - `/` or `/display` for the page
  - `/events` SSE stream
  - `/api/bootstrap` initial state payload
  - optional `/health`

#### Frontend
- load bootstrap state
- connect to `/events` via SSE
- render map to Canvas
- render recent kills list in HTML
- update on events
- schedule exact redraw on activity expiration based on timestamps

---

## Configuration Requirements

Configuration must be externalized.

Support configuration via:
- environment variables
- and/or a config file such as `config.json` or `config.local.json`

At minimum support:

```json
{
  "server": {
    "port": 3000
  },
  "r2z2": {
    "baseUrl": "https://r2z2.zkillboard.com/ephemeral",
    "sequenceUrl": "https://r2z2.zkillboard.com/ephemeral/sequence.json",
    "requestDelayMs": 100,
    "emptyDelayMs": 6000,
    "retryMs": 2000,
    "timeoutMs": 15000,
    "userAgent": "eve-killmap/1.0",
    "headers": {},
    "sequenceFile": "./data/r2z2-sequence.json",
    "startMode": "resume_or_latest"
  },
  "display": {
    "aspectRatio": "1:2",
    "widthPx": 1000,
    "maxRecentKills": 3,
    "activityWindowMs": 3600000,
    "pulseDurationMs": 1500
  },
  "map": {
    "systemsPath": "./data/systems.json",
    "edgesPath": "./data/edges.json",
    "regionsPath": "./data/regions.json"
  },
  "heatmap": {
    "tiers": [
      { "min": 1, "radius": 6, "alpha": 0.18 },
      { "min": 2, "radius": 9, "alpha": 0.28 },
      { "min": 4, "radius": 12, "alpha": 0.38 },
      { "min": 7, "radius": 16, "alpha": 0.5 }
    ]
  }
}
```

### Notes
- `r2z2.baseUrl` and `r2z2.sequenceUrl` must be configurable
- `r2z2.userAgent` must be configurable and non-empty
- `r2z2.sequenceFile` must be configurable
- do **not** build a generic multi-feed abstraction for v1
- keep config centralized and avoid hardcoding environment-specific values

---

## R2Z2 Ingestion Design

R2Z2 publishes the current starting point at `sequence.json`, then individual killmail files at `/<sequence>.json`. Best practice is to iterate forward until a 404 is received, then sleep at least 6 seconds before trying again. The `sequence.json` file updates every 51 killmails and is best used for bootstrap rather than every loop iteration. Filtering must happen after retrieval. citeturn815216view0

### Required ingestion behavior
- on startup:
  - load last saved sequence from disk if present
  - otherwise fetch `sequence.json`
- fetch `/<sequence>.json`
- if HTTP 200:
  - parse JSON
  - normalize into internal event shape
  - update in-memory state
  - broadcast via SSE
  - persist latest processed sequence
  - increment sequence
  - wait `requestDelayMs`
- if HTTP 404:
  - treat as "no new killmail yet"
  - wait at least `emptyDelayMs` (default 6000ms)
  - retry same sequence
- if HTTP 429:
  - back off and retry
- if HTTP 403:
  - log likely `User-Agent` / block issue clearly
  - retry conservatively
- if network error or 5xx:
  - back off and retry without crashing the app

### Important R2Z2 semantics
- `sequence_id` values are strictly increasing, global, monotonic, and not reused. citeturn815216view0
- Older killmails can appear because they are new to zKillboard, not necessarily newly occurring in EVE. citeturn815216view0
- The same killmail may later appear again with a new `sequence_id` if zKillboard reprocesses it. citeturn815216view0
- Sequence files are kept for at least 24 hours, so a very old persisted sequence may no longer be fetchable. citeturn815216view0

### Startup / recovery rules
- default `startMode`: `resume_or_latest`
- behavior:
  1. if saved sequence exists, try to continue from it
  2. if saved sequence is too old / missing / invalid, fetch latest `sequence.json`
  3. continue forward from there
- log clearly when a resume falls back to latest

---

## Internal Normalized Event Shape

Even though R2Z2 is the only feed source, normalize raw payloads into one internal event shape.

Example:

```ts
type KillEvent = {
  sequenceId: number;
  killId: number | string;
  hash?: string;
  systemId: number;
  systemName?: string;
  regionId?: number;
  regionName?: string;
  occurredAt: string;
  uploadedAt?: number;
  iskValue?: number;
  victimName?: string;
  shipName?: string;
  raw?: unknown;
};
```

### Mapping guidance
Codex should normalize at least these fields from R2Z2 when present:
- `sequence_id`
- `killmail_id`
- `hash`
- `killmail.solar_system_id`
- `killmail.killmail_time`
- `zkb.totalValue`
- `uploaded_at`

R2Z2 killmail files include the `killmail_id`, `hash`, raw ESI killmail, zKillboard metadata in the `zkb` block, `uploaded_at`, and `sequence_id`; updates may add fields later without breaking structure. citeturn815216view0

---

## Data Model

### Static map data
Precompute compact files for frontend/backend use.

#### `systems.json`
Each system should include:
- `id`
- `name`
- `x`
- `y`
- `regionId`

#### `edges.json`
Each edge should include two system IDs:
- `[fromSystemId, toSystemId]`

#### `regions.json`
Each region should include:
- `id`
- `name`
- `x`
- `y`

Coordinates should already be normalized for the target display space to minimize runtime math.

### Runtime state

#### Backend state
- `recentKills`: array of latest 3 normalized kill events
- `activityBySystem`: map of systemId -> array of timestamps within the last hour
- `currentSequence`: latest processed sequence ID

#### Frontend state
- cached static map data
- `recentKills`
- `activityBySystem`
- `activePulses`

---

## Rendering Strategy

### Why Canvas
Use **Canvas 2D** for the map because:
- many small dots and lines
- event-driven redraws
- lower overhead than SVG for this scene
- no need for per-system DOM interactivity

### Rendering layers
Use one visible canvas, plus an offscreen/static buffer.

#### Static layer
Draw once to an offscreen canvas:
- background
- connection lines
- system dots
- region labels

#### Dynamic redraw
On each redraw:
1. copy static layer to visible canvas
2. draw heat/activity glows
3. draw active pulses

#### Kill list
Render below the canvas using HTML, not canvas text.

---

## Redraw / Timing Model

Do **not** use a continuous animation loop.

Use:
- redraw on new kill
- redraw for active pulse frames only
- schedule a single timeout for the **next activity expiration**

### Exact behavior
When a kill arrives:
1. add timestamp to that system
2. prune all timestamps older than `activityWindowMs`
3. update recent kills
4. trigger redraw
5. start pulse animation for that system
6. compute next soonest expiration timestamp
7. set exactly one timeout for that expiration

When expiration timeout fires:
1. prune expired activity
2. redraw
3. compute the next expiration
4. schedule next timeout if needed

This preserves correctness for "past hour" heat without a polling render loop.

---

## Heatmap Model

Do **not** use a smeared geographical heatmap.

Use a **node-based heatmap**:
- each active system gets a soft glow centered on the system dot
- glow intensity depends on number of kills in the last hour

Suggested intensity tiers:
- 1 kill: faint glow
- 2-3 kills: medium glow
- 4-6 kills: strong glow
- 7+: very strong glow

The formula must remain config-driven.

---

## Pulse Effect

On new kill:
- render a short pulse at the system location
- expanding ring or two rings maximum
- fade out over configured duration

Requirements:
- pulse must be lightweight
- pulse duration configurable
- pulse animation should stop completely after finishing

---

## Frontend UI Requirements

### Map area
- dark theme
- no system labels
- region labels only
- clear dot/line style
- map should fit fixed aspect ratio cleanly

### Recent kills panel
Show last 3 kills.
At minimum each row should include:
- ISK value
- optionally system name and time if available

Suggested row fields:
- system name
- ISK value
- relative time or event time

Ensure formatting is large enough for a narrow side display.

---

## API Endpoints

### `GET /api/bootstrap`
Return initial state needed to render immediately.

Suggested payload:

```json
{
  "config": {
    "activityWindowMs": 3600000,
    "pulseDurationMs": 1500,
    "maxRecentKills": 3
  },
  "map": {
    "systems": [],
    "edges": [],
    "regions": []
  },
  "state": {
    "recentKills": [],
    "activityBySystem": {},
    "currentSequence": 0
  }
}
```

### `GET /events`
SSE stream for normalized updates.

Suggested event types:
- `kill`
- optional `heartbeat`
- optional `state-reset`

For v1, standard SSE messages with a JSON body are enough.

### `GET /health`
Basic health endpoint for deploy/debug.

---

## Suggested Project Structure

```text
project/
  src/
    server/
      index.js
      config.js
      state.js
      sse.js
      r2z2.js
      sequenceStore.js
      routes/
        bootstrap.js
        health.js
    client/
      index.html
      styles.css
      app.js
      render/
        map.js
        heatmap.js
        pulse.js
        kills.js
    shared/
      types.js
  data/
    systems.json
    edges.json
    regions.json
    r2z2-sequence.json
  config/
    default.json
    local.example.json
  package.json
  README.md
```

---

## Implementation Steps for Codex

### Phase 1: App skeleton
1. Create Node/Express app
2. Add config loading
3. Serve static frontend assets
4. Add `/health`
5. Add `/api/bootstrap`
6. Add `/events` SSE endpoint

### Phase 2: Static map
1. Define static map JSON schema
2. Load map data on server startup
3. Return map data in bootstrap endpoint
4. Build frontend canvas renderer
5. Draw:
   - lines
   - system dots
   - region labels

### Phase 3: R2Z2 ingestion
1. Implement R2Z2 sequence iterator
2. Add request headers including non-empty `User-Agent`
3. Add retry and error handling
4. Load and persist sequence file
5. Normalize incoming kill files
6. Push normalized events into backend state
7. Broadcast kill events to SSE clients

### Phase 4: Activity model
1. Implement rolling per-system timestamp storage
2. Implement prune logic
3. Implement exact next-expiration scheduling
4. Include current activity in bootstrap payload

### Phase 5: Frontend live updates
1. Fetch bootstrap payload
2. Render initial map + list
3. Open SSE connection
4. On kill event:
   - update activity
   - update recent list
   - trigger pulse
   - redraw map
5. Implement expiry-based redraw scheduling

### Phase 6: Polish
1. Tune heatmap tiers
2. Tune pulse animation
3. Improve typography for 1:2 display
4. Add resilient reconnect behavior
5. Add simple logging and error states
6. Add clear startup logging for sequence resume / fallback behavior

---

## Non-Goals for v1

Do not build these yet:
- alternate feed providers
- alternate transport adapters
- zoom/pan
- clickable systems
- ship icons on map
- full historical storage
- authentication
- admin UI
- multiple pages
- system labels
- advanced charting
- GPU/WebGL rendering

---

## Quality Requirements

### Performance
- no permanent render loop
- browser idle when no pulses and no updates
- map redraw should remain lightweight
- recent kills list updates should not cause full-page layout thrashing

### Reliability
- upstream R2Z2 failure should not crash the app
- R2Z2 retries should be automatic
- SSE reconnects should work cleanly
- malformed kill payloads should be ignored safely
- sequence persistence should be robust against partial writes where practical

### Maintainability
- config must be centralized
- rendering code should be split into small focused modules
- avoid hardcoding URLs or environment-specific values
- keep one normalization boundary between raw R2Z2 JSON and UI/state code

---

## Assumptions Locked In

These are fixed unless changed later:
- single deployment unit
- zKillboard **R2Z2 is the only upstream system**
- frontend consumes backend via SSE
- recent kill list shows last 3 entries
- ISK value is required in the list
- map width target is around 1000px
- page is optimized for a fixed 1:2 aspect ratio
- region labels are available in the static map dataset

---

## Deliverables

Codex should produce:
1. working single-app codebase
2. R2Z2 ingestion with persisted sequence tracking
3. canvas-rendered map with region labels
4. heat/activity layer for last hour
5. pulse on new kill
6. last 3 kills list including ISK value
7. README with setup and config instructions
8. example config file

---

## Final Guidance to Codex

Optimize for:
- simplicity
- low browser resource use
- easy configuration
- direct R2Z2 integration
- readability over premature abstraction

The most important implementation characteristics are:
- **single app**
- **R2Z2-only ingestion**
- **configurable R2Z2 base URL and timings**
- **non-empty configurable User-Agent**
- **persisted sequence tracking**
- **Canvas map**
- **event-driven redraws**
- **exact expiry redraw scheduling**
- **last 3 kills list with ISK value**
- **fixed 1:2 display layout**

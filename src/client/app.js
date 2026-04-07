import { createMapRenderer } from './render/map.js';
import { renderKillsList } from './render/kills.js';

const mapCanvas = document.getElementById('map-canvas');
const killsList = document.getElementById('kills-list');
const statusOverlay = document.getElementById('status-overlay');
const connectionLabel = document.getElementById('connection-label');
const killCountLabel = document.getElementById('kill-count-label');

let renderConfig = null;
let renderer = null;
let recentKills = [];
let activityBySystem = {};
let pulses = [];
let expiryTimer = null;
let pulseFrameId = null;
let resizeObserver = null;

boot().catch((error) => {
  console.error(error);
  setConnectionState('offline');
});

async function boot() {
  const bootstrap = await fetchJson('/api/bootstrap');
  renderConfig = bootstrap.config;
  applyDisplayConfig(renderConfig);
  await waitForFonts();
  recentKills = bootstrap.state.recentKills ?? [];
  activityBySystem = bootstrap.state.activityBySystem ?? {};
  renderer = createMapRenderer(mapCanvas, bootstrap.map, renderConfig);
  syncRendererSize();
  attachResizeHandling();

  renderKillsList(killsList, recentKills);
  pruneActivity(Date.now());
  updateStatusText();
  renderFrame();
  scheduleNextExpiry();
  connectEvents();
}

function connectEvents() {
  const source = new EventSource('/events');

  source.addEventListener('open', () => {
    setConnectionState('online');
  });

  source.addEventListener('error', () => {
    setConnectionState('offline');
  });

  source.addEventListener('kill', (event) => {
    const killEvent = JSON.parse(event.data);
    recentKills = [killEvent, ...recentKills].slice(0, renderConfig.maxRecentKills);
    renderKillsList(killsList, recentKills);
    addActivity(killEvent);
    startPulse(killEvent.systemId);
    updateStatusText();
    renderFrame();
  });
}

function addActivity(killEvent) {
  const occurredAt = Date.parse(killEvent.occurredAt);
  const now = Date.now();
  if (!Number.isFinite(occurredAt) || occurredAt < now - renderConfig.activityWindowMs) {
    scheduleNextExpiry();
    return;
  }

  const key = String(killEvent.systemId);
  const timestamps = [...(activityBySystem[key] ?? []), occurredAt].sort(
    (left, right) => left - right
  );
  activityBySystem[key] = timestamps;
  pruneActivity(now);
  scheduleNextExpiry();
}

function pruneActivity(now) {
  const cutoff = now - renderConfig.activityWindowMs;
  const nextActivity = {};
  for (const [systemId, timestamps] of Object.entries(activityBySystem)) {
    const remaining = timestamps.filter((timestamp) => timestamp >= cutoff);
    if (remaining.length) {
      nextActivity[systemId] = remaining;
    }
  }
  activityBySystem = nextActivity;
  updateStatusText();
}

function scheduleNextExpiry() {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  const now = Date.now();
  let nextExpirationAt = null;
  for (const timestamps of Object.values(activityBySystem)) {
    if (!timestamps.length) {
      continue;
    }

    const candidate = timestamps[0] + renderConfig.activityWindowMs;
    if (candidate > now && (nextExpirationAt === null || candidate < nextExpirationAt)) {
      nextExpirationAt = candidate;
    }
  }

  if (nextExpirationAt === null) {
    renderFrame();
    return;
  }

  expiryTimer = window.setTimeout(() => {
    pruneActivity(Date.now());
    renderFrame();
    scheduleNextExpiry();
  }, Math.max(0, nextExpirationAt - now));
}

function startPulse(systemId) {
  pulses.push({
    systemId,
    startedAt: performance.now(),
    now: performance.now()
  });

  if (pulseFrameId !== null) {
    return;
  }

  pulseFrameId = requestAnimationFrame(stepPulseAnimation);
}

function stepPulseAnimation(now) {
  pulses = pulses
    .map((pulse) => ({ ...pulse, now }))
    .filter((pulse) => now - pulse.startedAt < renderConfig.pulseDurationMs);

  renderFrame();

  if (pulses.length === 0) {
    pulseFrameId = null;
    return;
  }

  pulseFrameId = requestAnimationFrame(stepPulseAnimation);
}

function renderFrame() {
  if (!renderer) {
    return;
  }

  renderer.render({
    activityBySystem,
    pulses
  });
}

function setConnectionState(state, label) {
  const normalizedLabel = state === 'online' ? 'Online' : 'Offline';
  connectionLabel.textContent = normalizedLabel;
  statusOverlay.setAttribute('aria-label', normalizedLabel);
  statusOverlay.setAttribute('title', normalizedLabel);
}

function applyDisplayConfig(config) {
  document.documentElement.style.setProperty('--display-width', `${config.widthPx}px`);
  document.documentElement.style.setProperty(
    '--display-aspect-ratio',
    String(config.aspectRatio).replace(':', ' / ')
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }
  return response.json();
}

function updateStatusText() {
  const totalKills = Object.values(activityBySystem).reduce(
    (sum, timestamps) => sum + timestamps.length,
    0
  );
  killCountLabel.textContent = `${totalKills} kill${totalKills === 1 ? '' : 's'} past hour`;
}

async function waitForFonts() {
  if (!document.fonts) {
    return;
  }

  await Promise.allSettled([
    document.fonts.load('400 16px "Eve Sans Neue"'),
    document.fonts.load('700 16px "Eve Sans Neue"'),
    document.fonts.load('400 12px "Eve Sans Neue Condensed"'),
    document.fonts.load('700 12px "Eve Sans Neue Condensed"')
  ]);
}

function syncRendererSize() {
  if (!renderer) {
    return;
  }

  const bounds = mapCanvas.getBoundingClientRect();
  renderer.resize(bounds.width, bounds.height);
}

function attachResizeHandling() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(() => {
      syncRendererSize();
      renderFrame();
    });
    resizeObserver.observe(mapCanvas);
    return;
  }

  window.addEventListener('resize', () => {
    syncRendererSize();
    renderFrame();
  });
}

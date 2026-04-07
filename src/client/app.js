import { createMapRenderer } from './render/map.js';
import { renderKillsList } from './render/kills.js';
import { createKillFocusController } from './camera.js';

const mapCanvas = document.getElementById('map-canvas');
const killsList = document.getElementById('kills-list');
const statusOverlay = document.getElementById('status-overlay');
const connectionLabel = document.getElementById('connection-label');
const killCountLabel = document.getElementById('kill-count-label');
const cameraToggle = document.getElementById('camera-toggle');

const CAMERA_ENABLED_STORAGE_KEY = 'eve-killmap.camera-enabled';

let renderConfig = null;
let renderer = null;
let recentKills = [];
let activityBySystem = {};
let pulses = [];
let expiryTimer = null;
let animationFrameId = null;
let resizeObserver = null;
let cameraController = null;
let highlightedKillId = null;

boot().catch((error) => {
  console.error(error);
  setConnectionState('offline');
});

async function boot() {
  const bootstrap = await fetchJson(getBootstrapUrl());
  renderConfig = bootstrap.config;
  applyDisplayConfig(renderConfig);
  await waitForFonts();
  recentKills = bootstrap.state.recentKills ?? [];
  activityBySystem = bootstrap.state.activityBySystem ?? {};
  renderer = createMapRenderer(mapCanvas, bootstrap.map, renderConfig);
  cameraController = createKillFocusController({
    systems: bootstrap.map.systems,
    cameraZoomScale: renderConfig.cameraZoomScale,
    cameraMoveDurationMs: renderConfig.cameraMoveDurationMs,
    cameraLockMs: renderConfig.cameraLockMs,
    cameraResetIdleMs: renderConfig.cameraResetIdleMs,
    cameraSelectionDebounceMs: renderConfig.cameraSelectionDebounceMs,
    enabled: loadCameraEnabledPreference(),
    onChange() {
      syncHighlightedKill();
      renderFrame();
      ensureAnimationLoop();
    }
  });
  syncRendererSize();
  attachResizeHandling();
  attachCameraToggleHandling();
  updateCameraToggleUi();

  renderKills();
  attachKillListInteractions();
  pruneActivity(Date.now());
  updateStatusText();
  renderFrame();
  scheduleNextExpiry();
  connectEvents();
}

function attachCameraToggleHandling() {
  cameraToggle.addEventListener('click', () => {
    const nextEnabled = !cameraController.isEnabled();
    cameraController.setEnabled(nextEnabled);
    persistCameraEnabledPreference(nextEnabled);
    updateCameraToggleUi();
    syncHighlightedKill();
    renderFrame();
  });
}

function attachKillListInteractions() {
  killsList.addEventListener('click', (event) => {
    const row = findKillRow(event.target);
    if (!row) {
      return;
    }

    focusKillRow(row);
  });

  killsList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const row = findKillRow(event.target);
    if (!row) {
      return;
    }

    event.preventDefault();
    focusKillRow(row);
  });
}

function focusKillRow(row) {
  const killIndex = Number(row.dataset.killIndex);
  if (!Number.isInteger(killIndex) || killIndex < 0 || killIndex >= recentKills.length) {
    return;
  }

  const killEvent = recentKills[killIndex];
  if (!killEvent || !cameraController?.focusKill(killEvent)) {
    return;
  }

  renderFrame();
  ensureAnimationLoop();
}

function findKillRow(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest('.kill-row');
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
    renderKills();
    addActivity(killEvent);
    startPulse(killEvent.systemId);
    cameraController.handleKill(killEvent);
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

  ensureAnimationLoop();
}

function stepAnimation(now) {
  pulses = pulses
    .map((pulse) => ({ ...pulse, now }))
    .filter((pulse) => now - pulse.startedAt < renderConfig.pulseDurationMs);

  renderFrame(now);

  if (pulses.length === 0 && !cameraController?.isAnimating(now)) {
    animationFrameId = null;
    return;
  }

  animationFrameId = requestAnimationFrame(stepAnimation);
}

function ensureAnimationLoop() {
  if (animationFrameId !== null) {
    return;
  }

  animationFrameId = requestAnimationFrame(stepAnimation);
}

function renderFrame(now = performance.now()) {
  if (!renderer) {
    return;
  }

  renderer.render({
    activityBySystem,
    pulses,
    camera: cameraController?.getViewport(now)
  });
}

function renderKills() {
  highlightedKillId = cameraController?.getActiveKillId() ?? null;
  renderKillsList(killsList, recentKills, {
    activeKillId: highlightedKillId
  });
}

function syncHighlightedKill() {
  const nextHighlightedKillId = cameraController?.getActiveKillId() ?? null;
  if (nextHighlightedKillId === highlightedKillId) {
    return;
  }

  renderKills();
}

function updateCameraToggleUi() {
  if (!cameraController) {
    return;
  }

  const enabled = cameraController.isEnabled();
  cameraToggle.classList.toggle('is-disabled', !enabled);
  cameraToggle.setAttribute('aria-pressed', String(enabled));
  cameraToggle.setAttribute('aria-label', enabled ? 'Disable map motion' : 'Enable map motion');
  cameraToggle.setAttribute('title', enabled ? 'Disable map motion' : 'Enable map motion');
}

function setConnectionState(state, label) {
  const normalizedLabel = state === 'online' ? 'Online' : 'Offline';
  connectionLabel.textContent = normalizedLabel;
  statusOverlay.setAttribute('aria-label', normalizedLabel);
  statusOverlay.setAttribute('title', normalizedLabel);
}

function applyDisplayConfig(config) {
  const aspectRatio = normalizeAspectRatio(config.aspectRatio);
  document.documentElement.style.setProperty('--display-width', `${config.widthPx}px`);
  document.documentElement.style.setProperty('--display-aspect-ratio', aspectRatio);
}

function normalizeAspectRatio(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '1 / 2';
  }

  return normalized.replace(':', ' / ');
}

function loadCameraEnabledPreference() {
  try {
    const stored = window.localStorage.getItem(CAMERA_ENABLED_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function persistCameraEnabledPreference(enabled) {
  try {
    window.localStorage.setItem(CAMERA_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage failures and keep the current in-memory state.
  }
}

function getBootstrapUrl() {
  const search = window.location.search ?? '';
  return search ? `/api/bootstrap${search}` : '/api/bootstrap';
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

import path from 'node:path';
import { deepMerge, fileExists, readJsonFile, resolveProjectPath } from './utils.js';

const OPTIONAL_CONFIG_PATHS = [
  'config/local.json',
  'config/config.local.json',
  'config.local.json'
];

const MIN_R2Z2_REQUEST_DELAY_MS = 50;
const MIN_R2Z2_EMPTY_DELAY_MS = 6000;
const DEFAULT_MAX_CONSECUTIVE_MISSING_BEFORE_SKIP = 5;
const DEFAULT_MAX_CONSECUTIVE_RETRY_BEFORE_SKIP = 5;

const ENV_NUMBER_OVERRIDES = {
  PORT: ['server', 'port'],
  R2Z2_REQUEST_DELAY_MS: ['r2z2', 'requestDelayMs'],
  R2Z2_EMPTY_DELAY_MS: ['r2z2', 'emptyDelayMs'],
  R2Z2_RETRY_MS: ['r2z2', 'retryMs'],
  R2Z2_TIMEOUT_MS: ['r2z2', 'timeoutMs'],
  R2Z2_MAX_CONSECUTIVE_MISSING_BEFORE_SKIP: ['r2z2', 'maxConsecutiveMissingBeforeSkip'],
  R2Z2_MAX_CONSECUTIVE_RETRY_BEFORE_SKIP: ['r2z2', 'maxConsecutiveRetryBeforeSkip'],
  DISPLAY_WIDTH_PX: ['display', 'widthPx'],
  DISPLAY_MAX_RECENT_KILLS: ['display', 'maxRecentKills'],
  DISPLAY_ACTIVITY_WINDOW_MS: ['display', 'activityWindowMs'],
  DISPLAY_PULSE_DURATION_MS: ['display', 'pulseDurationMs'],
  DISPLAY_CAMERA_ZOOM_SCALE: ['display', 'cameraZoomScale'],
  DISPLAY_CAMERA_MOVE_DURATION_MS: ['display', 'cameraMoveDurationMs'],
  DISPLAY_CAMERA_LOCK_MS: ['display', 'cameraLockMs'],
  DISPLAY_CAMERA_RESET_IDLE_MS: ['display', 'cameraResetIdleMs'],
  DISPLAY_CAMERA_SELECTION_DEBOUNCE_MS: ['display', 'cameraSelectionDebounceMs']
};

const ENV_STRING_OVERRIDES = {
  R2Z2_BASE_URL: ['r2z2', 'baseUrl'],
  R2Z2_SEQUENCE_URL: ['r2z2', 'sequenceUrl'],
  R2Z2_USER_AGENT: ['r2z2', 'userAgent'],
  R2Z2_SEQUENCE_FILE: ['r2z2', 'sequenceFile'],
  R2Z2_START_MODE: ['r2z2', 'startMode'],
  DISPLAY_ASPECT_RATIO: ['display', 'aspectRatio'],
  MAP_SYSTEMS_PATH: ['map', 'systemsPath'],
  MAP_EDGES_PATH: ['map', 'edgesPath'],
  MAP_REGIONS_PATH: ['map', 'regionsPath']
};

export async function loadConfig(projectRoot = process.cwd(), env = process.env) {
  const defaultPath = path.join(projectRoot, 'config', 'default.json');
  let config = await readJsonFile(defaultPath);

  for (const relativePath of OPTIONAL_CONFIG_PATHS) {
    const candidatePath = path.join(projectRoot, relativePath);
    if (await fileExists(candidatePath)) {
      config = deepMerge(config, await readJsonFile(candidatePath));
    }
  }

  if (env.EVE_KILLMAP_CONFIG) {
    const explicitPath = resolveProjectPath(projectRoot, env.EVE_KILLMAP_CONFIG);
    if (await fileExists(explicitPath)) {
      config = deepMerge(config, await readJsonFile(explicitPath));
    }
  }

  const envOverrides = {};
  for (const [envKey, pathParts] of Object.entries(ENV_NUMBER_OVERRIDES)) {
    if (!(envKey in env) || env[envKey] === '') {
      continue;
    }

    const parsed = Number(env[envKey]);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Environment override ${envKey} must be numeric.`);
    }

    assignNested(envOverrides, pathParts, parsed);
  }

  for (const [envKey, pathParts] of Object.entries(ENV_STRING_OVERRIDES)) {
    if (!(envKey in env) || env[envKey] === '') {
      continue;
    }

    assignNested(envOverrides, pathParts, env[envKey]);
  }

  if (env.R2Z2_HEADERS_JSON) {
    assignNested(envOverrides, ['r2z2', 'headers'], JSON.parse(env.R2Z2_HEADERS_JSON));
  }

  if (env.HEATMAP_TIERS_JSON) {
    assignNested(envOverrides, ['heatmap', 'tiers'], JSON.parse(env.HEATMAP_TIERS_JSON));
  }

  config = deepMerge(config, envOverrides);
  config.server.port = Number(config.server.port);
  config.display.widthPx = Number(config.display.widthPx);
  config.display.maxRecentKills = Number(config.display.maxRecentKills);
  config.display.activityWindowMs = Number(config.display.activityWindowMs);
  config.display.pulseDurationMs = Number(config.display.pulseDurationMs);
  config.display.cameraZoomScale = Number(config.display.cameraZoomScale);
  config.display.cameraMoveDurationMs = Number(config.display.cameraMoveDurationMs);
  config.display.cameraLockMs = Number(config.display.cameraLockMs);
  config.display.cameraResetIdleMs = Number(config.display.cameraResetIdleMs);
  config.display.cameraSelectionDebounceMs = Number(config.display.cameraSelectionDebounceMs);
  config.r2z2.requestDelayMs = Number(config.r2z2.requestDelayMs);
  config.r2z2.emptyDelayMs = Number(config.r2z2.emptyDelayMs);
  config.r2z2.retryMs = Number(config.r2z2.retryMs);
  config.r2z2.timeoutMs = Number(config.r2z2.timeoutMs);
  config.r2z2.maxConsecutiveMissingBeforeSkip = normalizePositiveInteger(
    config.r2z2.maxConsecutiveMissingBeforeSkip,
    DEFAULT_MAX_CONSECUTIVE_MISSING_BEFORE_SKIP
  );
  config.r2z2.maxConsecutiveRetryBeforeSkip = normalizePositiveInteger(
    config.r2z2.maxConsecutiveRetryBeforeSkip,
    DEFAULT_MAX_CONSECUTIVE_RETRY_BEFORE_SKIP
  );

  config.r2z2.requestDelayMs = Math.max(
    MIN_R2Z2_REQUEST_DELAY_MS,
    config.r2z2.requestDelayMs
  );
  config.r2z2.emptyDelayMs = Math.max(
    MIN_R2Z2_EMPTY_DELAY_MS,
    config.r2z2.emptyDelayMs
  );

  config.r2z2.userAgent = String(config.r2z2.userAgent ?? '').trim();
  if (!config.r2z2.userAgent) {
    throw new Error('Config r2z2.userAgent must be non-empty.');
  }

  if (config.r2z2.startMode !== 'resume_or_latest') {
    throw new Error('Config r2z2.startMode must be "resume_or_latest" for v1.');
  }

  config.r2z2.sequenceFile = resolveProjectPath(projectRoot, config.r2z2.sequenceFile);
  config.map.systemsPath = resolveProjectPath(projectRoot, config.map.systemsPath);
  config.map.edgesPath = resolveProjectPath(projectRoot, config.map.edgesPath);
  config.map.regionsPath = resolveProjectPath(projectRoot, config.map.regionsPath);

  return config;
}

function assignNested(target, pathParts, value) {
  let cursor = target;
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const key = pathParts[index];
    cursor[key] = cursor[key] ?? {};
    cursor = cursor[key];
  }

  cursor[pathParts[pathParts.length - 1]] = value;
}

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    return fallback;
  }

  return numericValue;
}

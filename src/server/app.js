import express from 'express';
import path from 'node:path';

export function createApp({ config, mapData, state, sseHub, ingestor = null }) {
  const app = express();
  const clientRoot = path.resolve(process.cwd(), 'src', 'client');

  app.disable('x-powered-by');
  app.use(express.static(clientRoot, { extensions: ['html'] }));

  app.get(['/', '/display'], (_request, response) => {
    response.sendFile(path.join(clientRoot, 'index.html'));
  });

  app.get('/api/bootstrap', (request, response) => {
    const displayOverrides = resolveDisplayOverrides(request.query, config.display);
    response.json({
      config: {
        aspectRatio: displayOverrides.aspectRatio,
        widthPx: displayOverrides.widthPx,
        activityWindowMs: config.display.activityWindowMs,
        pulseDurationMs: config.display.pulseDurationMs,
        maxRecentKills: config.display.maxRecentKills,
        cameraZoomScale: config.display.cameraZoomScale,
        cameraMoveDurationMs: config.display.cameraMoveDurationMs,
        cameraLockMs: config.display.cameraLockMs,
        cameraResetIdleMs: config.display.cameraResetIdleMs,
        cameraSelectionDebounceMs: config.display.cameraSelectionDebounceMs,
        heatmapTiers: config.heatmap.tiers
      },
      map: {
        systems: mapData.systems,
        edges: mapData.edges,
        regions: mapData.regions
      },
      state: state.getBootstrapState()
    });
  });

  app.get('/events', (_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.write('retry: 5000\n\n');
    sseHub.addClient(response);
  });

  app.get('/health', (_request, response) => {
    const ingestStatus = ingestor?.getStatus?.() ?? null;
    response.json({
      ok: true,
      currentSequence: state.getCurrentSequence(),
      sseClients: sseHub.getClientCount(),
      ingest: ingestStatus
    });
  });

  return app;
}

function resolveDisplayOverrides(query, displayConfig) {
  return {
    aspectRatio: normalizeAspectRatioQuery(query.aspectRatio, displayConfig.aspectRatio),
    widthPx: normalizeWidthPxQuery(query.widthPx, displayConfig.widthPx)
  };
}

function normalizeAspectRatioQuery(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return fallback;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return fallback;
  }

  return `${width}:${height}`;
}

function normalizeWidthPxQuery(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
}

import express from 'express';
import path from 'node:path';

export function createApp({ config, mapData, state, sseHub, devLiveReload = false }) {
  const app = express();
  const clientRoot = path.resolve(process.cwd(), 'src', 'client');

  app.disable('x-powered-by');
  app.use(express.static(clientRoot, { extensions: ['html'] }));

  app.get(['/', '/display'], (_request, response) => {
    response.sendFile(path.join(clientRoot, 'index.html'));
  });

  app.get('/api/bootstrap', (_request, response) => {
    response.json({
      config: {
        aspectRatio: config.display.aspectRatio,
        widthPx: config.display.widthPx,
        activityWindowMs: config.display.activityWindowMs,
        pulseDurationMs: config.display.pulseDurationMs,
        maxRecentKills: config.display.maxRecentKills,
        heatmapTiers: config.heatmap.tiers,
        devLiveReload
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
    response.json({
      ok: true,
      currentSequence: state.getCurrentSequence(),
      sseClients: sseHub.getClientCount()
    });
  });

  if (devLiveReload) {
    app.get('/__dev/reload', (_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      response.write('retry: 300\n\n');

      const heartbeat = setInterval(() => {
        response.write(': heartbeat\n\n');
      }, 15000);
      heartbeat.unref?.();

      response.on('close', () => {
        clearInterval(heartbeat);
      });
    });
  }

  return app;
}

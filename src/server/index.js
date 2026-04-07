import { loadConfig } from './config.js';
import { loadMapData } from './mapData.js';
import { createRuntimeState } from './state.js';
import { createSseHub } from './sse.js';
import { createR2Z2Ingestor } from './r2z2.js';
import { createApp } from './app.js';

async function main() {
  const config = await loadConfig();
  const mapData = await loadMapData(config);
  const state = createRuntimeState(config);
  const sseHub = createSseHub();
  const ingestor = createR2Z2Ingestor({ config, state, sseHub, mapData });
  const app = createApp({ config, mapData, state, sseHub, ingestor });

  const server = app.listen(config.server.port, () => {
    console.log(`eve-hyte-map listening on http://localhost:${config.server.port}`);
  });

  const shutdown = async () => {
    await ingestor.stop();
    sseHub.closeAll();
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await ingestor.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

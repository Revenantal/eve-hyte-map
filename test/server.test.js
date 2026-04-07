import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/app.js';

test('bootstrap and health endpoints return the expected payload shape', async () => {
  const config = {
    display: {
      aspectRatio: '1:2',
      widthPx: 1000,
      activityWindowMs: 3_600_000,
      pulseDurationMs: 1_500,
      maxRecentKills: 3,
      cameraZoomScale: 1.5,
      cameraMoveDurationMs: 5_000,
      cameraLockMs: 30_000,
      cameraResetIdleMs: 60_000,
      cameraSelectionDebounceMs: 3_000
    },
    heatmap: {
      tiers: [{ min: 1, radius: 6, alpha: 0.2 }]
    }
  };

  const mapData = {
    systems: [{ id: 30000001, name: 'Tanoo', x: 0.5, y: 0.5, regionId: 10000001 }],
    edges: [[30000001, 30000002]],
    regions: [{ id: 10000001, name: 'Derelik', x: 0.5, y: 0.5 }]
  };

  const state = {
    getBootstrapState() {
      return {
        recentKills: [],
        activityBySystem: {},
        currentSequence: 42
      };
    },
    getCurrentSequence() {
      return 42;
    }
  };

  const sseHub = {
    addClient() {},
    getClientCount() {
      return 0;
    }
  };

  const app = createApp({ config, mapData, state, sseHub });
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`);
  const bootstrapJson = await bootstrapResponse.json();
  const healthResponse = await fetch(`${baseUrl}/health`);
  const healthJson = await healthResponse.json();

  server.close();

  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapJson.config.aspectRatio, '1:2');
  assert.equal(bootstrapJson.config.widthPx, 1000);
  assert.equal(bootstrapJson.config.maxRecentKills, 3);
  assert.equal(bootstrapJson.config.cameraZoomScale, 1.5);
  assert.equal(bootstrapJson.config.cameraMoveDurationMs, 5_000);
  assert.equal(bootstrapJson.config.cameraLockMs, 30_000);
  assert.equal(bootstrapJson.config.cameraResetIdleMs, 60_000);
  assert.equal(bootstrapJson.config.cameraSelectionDebounceMs, 3_000);
  assert.equal(bootstrapJson.map.systems.length, 1);
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.currentSequence, 42);
});

test('bootstrap accepts aspect ratio and width overrides from the URL query', async () => {
  const config = {
    display: {
      aspectRatio: '1:2',
      widthPx: 1000,
      activityWindowMs: 3_600_000,
      pulseDurationMs: 1_500,
      maxRecentKills: 3,
      cameraZoomScale: 1.5,
      cameraMoveDurationMs: 5_000,
      cameraLockMs: 30_000,
      cameraResetIdleMs: 60_000,
      cameraSelectionDebounceMs: 3_000
    },
    heatmap: {
      tiers: [{ min: 1, radius: 6, alpha: 0.2 }]
    }
  };

  const mapData = {
    systems: [],
    edges: [],
    regions: []
  };

  const state = {
    getBootstrapState() {
      return {
        recentKills: [],
        activityBySystem: {},
        currentSequence: 42
      };
    },
    getCurrentSequence() {
      return 42;
    }
  };

  const sseHub = {
    addClient() {},
    getClientCount() {
      return 0;
    }
  };

  const app = createApp({ config, mapData, state, sseHub });
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const overrideResponse = await fetch(
    `${baseUrl}/api/bootstrap?aspectRatio=1:2.05&widthPx=1030`
  );
  const overrideJson = await overrideResponse.json();

  const invalidResponse = await fetch(
    `${baseUrl}/api/bootstrap?aspectRatio=oops&widthPx=-10`
  );
  const invalidJson = await invalidResponse.json();

  server.close();

  assert.equal(overrideResponse.status, 200);
  assert.equal(overrideJson.config.aspectRatio, '1:2.05');
  assert.equal(overrideJson.config.widthPx, 1030);
  assert.equal(invalidJson.config.aspectRatio, '1:2');
  assert.equal(invalidJson.config.widthPx, 1000);
});

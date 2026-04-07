import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/app.js';

test('bootstrap and health endpoints return the expected payload shape', async () => {
  const config = {
    display: {
      activityWindowMs: 3_600_000,
      pulseDurationMs: 1_500,
      maxRecentKills: 3
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
  assert.equal(bootstrapJson.config.maxRecentKills, 3);
  assert.equal(bootstrapJson.map.systems.length, 1);
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.currentSequence, 42);
});

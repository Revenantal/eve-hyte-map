import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';

test('loadConfig applies env overrides over file config', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eve-killmap-config-'));
  await fs.mkdir(path.join(tempRoot, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(tempRoot, 'config', 'default.json'),
    JSON.stringify({
      server: { port: 3000 },
      r2z2: {
        baseUrl: 'https://example.com',
        sequenceUrl: 'https://example.com/sequence.json',
        requestDelayMs: 100,
        emptyDelayMs: 6000,
        retryMs: 2000,
        timeoutMs: 15000,
        userAgent: 'base-agent',
        headers: {},
        sequenceFile: './data/sequence.json',
        startMode: 'resume_or_latest'
      },
      display: {
        aspectRatio: '1:2',
        widthPx: 1000,
        maxRecentKills: 3,
        activityWindowMs: 3600000,
        pulseDurationMs: 1500,
        cameraZoomScale: 1.5,
        cameraMoveDurationMs: 5000,
        cameraLockMs: 30000,
        cameraResetIdleMs: 60000,
        cameraSelectionDebounceMs: 3000
      },
      map: {
        systemsPath: './data/systems.json',
        edgesPath: './data/edges.json',
        regionsPath: './data/regions.json'
      },
      heatmap: {
        tiers: [{ min: 1, radius: 6, alpha: 0.2 }]
      }
    })
  );

  const config = await loadConfig(tempRoot, {
    PORT: '4100',
    R2Z2_USER_AGENT: 'env-agent'
  });

  assert.equal(config.server.port, 4100);
  assert.equal(config.r2z2.userAgent, 'env-agent');
  assert.equal(config.map.systemsPath, path.join(tempRoot, 'data', 'systems.json'));
});

test('loadConfig rejects an empty user agent', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eve-killmap-config-'));
  await fs.mkdir(path.join(tempRoot, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(tempRoot, 'config', 'default.json'),
    JSON.stringify({
      server: { port: 3000 },
      r2z2: {
        baseUrl: 'https://example.com',
        sequenceUrl: 'https://example.com/sequence.json',
        requestDelayMs: 100,
        emptyDelayMs: 6000,
        retryMs: 2000,
        timeoutMs: 15000,
        userAgent: '',
        headers: {},
        sequenceFile: './data/sequence.json',
        startMode: 'resume_or_latest'
      },
      display: {
        aspectRatio: '1:2',
        widthPx: 1000,
        maxRecentKills: 3,
        activityWindowMs: 3600000,
        pulseDurationMs: 1500,
        cameraZoomScale: 1.5,
        cameraMoveDurationMs: 5000,
        cameraLockMs: 30000,
        cameraResetIdleMs: 60000,
        cameraSelectionDebounceMs: 3000
      },
      map: {
        systemsPath: './data/systems.json',
        edgesPath: './data/edges.json',
        regionsPath: './data/regions.json'
      },
      heatmap: {
        tiers: [{ min: 1, radius: 6, alpha: 0.2 }]
      }
    })
  );

  await assert.rejects(() => loadConfig(tempRoot, {}), /non-empty/);
});

test('loadConfig clamps R2Z2 timings to documented safe minimums', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eve-killmap-config-'));
  await fs.mkdir(path.join(tempRoot, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(tempRoot, 'config', 'default.json'),
    JSON.stringify({
      server: { port: 3000 },
      r2z2: {
        baseUrl: 'https://example.com',
        sequenceUrl: 'https://example.com/sequence.json',
        requestDelayMs: 1,
        emptyDelayMs: 1000,
        retryMs: 2000,
        timeoutMs: 15000,
        userAgent: 'base-agent',
        headers: {},
        sequenceFile: './data/sequence.json',
        startMode: 'resume_or_latest'
      },
      display: {
        aspectRatio: '1:2',
        widthPx: 1000,
        maxRecentKills: 3,
        activityWindowMs: 3600000,
        pulseDurationMs: 1500,
        cameraZoomScale: 1.5,
        cameraMoveDurationMs: 5000,
        cameraLockMs: 30000,
        cameraResetIdleMs: 60000,
        cameraSelectionDebounceMs: 3000
      },
      map: {
        systemsPath: './data/systems.json',
        edgesPath: './data/edges.json',
        regionsPath: './data/regions.json'
      },
      heatmap: {
        tiers: [{ min: 1, radius: 6, alpha: 0.2 }]
      }
    })
  );

  const config = await loadConfig(tempRoot, {});

  assert.equal(config.r2z2.requestDelayMs, 50);
  assert.equal(config.r2z2.emptyDelayMs, 6000);
});

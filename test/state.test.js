import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeState } from '../src/server/state.js';

const baseConfig = {
  display: {
    activityWindowMs: 3_600_000,
    maxRecentKills: 3
  }
};

test('runtime state caps recent kills and schedules expiry from oldest active timestamp', () => {
  const state = createRuntimeState(baseConfig);
  const now = Date.parse('2026-04-06T20:00:00Z');

  state.applyKill(
    {
      sequenceId: 1,
      killId: 1001,
      systemId: 30000142,
      occurredAt: new Date(now - 10_000).toISOString()
    },
    now
  );
  state.applyKill(
    {
      sequenceId: 2,
      killId: 1002,
      systemId: 30000142,
      occurredAt: new Date(now - 5_000).toISOString()
    },
    now
  );
  state.applyKill(
    {
      sequenceId: 3,
      killId: 1003,
      systemId: 30000144,
      occurredAt: new Date(now - 2_000).toISOString()
    },
    now
  );
  state.applyKill(
    {
      sequenceId: 4,
      killId: 1004,
      systemId: 30000145,
      occurredAt: new Date(now - 1_000).toISOString()
    },
    now
  );

  const bootstrap = state.getBootstrapState(now);
  assert.equal(bootstrap.recentKills.length, 3);
  assert.deepEqual(Object.keys(bootstrap.activityBySystem).sort(), [
    '30000142',
    '30000144',
    '30000145'
  ]);
  assert.equal(state.getNextExpirationAt(now), now - 10_000 + 3_600_000);
});

test('runtime state prunes expired activity without removing recent kill history', () => {
  const state = createRuntimeState(baseConfig);
  const now = Date.parse('2026-04-06T20:00:00Z');

  state.applyKill(
    {
      sequenceId: 5,
      killId: 1005,
      systemId: 30000142,
      occurredAt: new Date(now - 3_700_000).toISOString()
    },
    now
  );

  const bootstrap = state.getBootstrapState(now);
  assert.equal(bootstrap.recentKills.length, 1);
  assert.deepEqual(bootstrap.activityBySystem, {});
  assert.equal(state.getNextExpirationAt(now), null);
});

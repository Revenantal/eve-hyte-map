import test from 'node:test';
import assert from 'node:assert/strict';
import { createKillFocusController, DEFAULT_CAMERA, compareKillsByPriority } from '../src/client/camera.js';

const SYSTEMS = [
  { id: 30000001, x: 0.2, y: 0.25 },
  { id: 30000002, x: 0.72, y: 0.61 },
  { id: 30000003, x: 0.83, y: 0.18 }
];

test('burst selection chooses the highest-value kill after the debounce window', () => {
  const clock = createFakeClock();
  const controller = createController(clock);

  controller.handleKill(createKillEvent({ systemId: 30000001, iskValue: 20, occurredAt: '2026-04-06T23:00:00Z', sequenceId: 10 }));
  clock.advanceBy(1_000);
  controller.handleKill(createKillEvent({ systemId: 30000002, iskValue: 45, occurredAt: '2026-04-06T23:00:01Z', sequenceId: 11 }));
  clock.advanceBy(1_999);

  assertViewport(controller.getViewport(), DEFAULT_CAMERA);

  clock.advanceBy(1);
  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), { centerX: 0.72, centerY: 0.61, zoom: 1.5 });
});

test('lock window keeps only the best queued candidate and executes it immediately on unlock', () => {
  const clock = createFakeClock();
  const controller = createController(clock);

  controller.handleKill(createKillEvent({ systemId: 30000001, iskValue: 20, occurredAt: '2026-04-06T23:00:00Z', sequenceId: 10 }));
  clock.advanceBy(3_000);
  clock.advanceBy(5_000);

  controller.handleKill(createKillEvent({ systemId: 30000002, iskValue: 15, occurredAt: '2026-04-06T23:00:05Z', sequenceId: 11 }));
  controller.handleKill(createKillEvent({ systemId: 30000003, iskValue: 90, occurredAt: '2026-04-06T23:00:06Z', sequenceId: 12 }));
  clock.advanceBy(24_999);

  assertViewport(controller.getViewport(), { centerX: 0.2, centerY: 0.25, zoom: 1.5 });

  clock.advanceBy(1);
  assert.equal(controller.isAnimating(), true);

  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), { centerX: 0.83, centerY: 0.18, zoom: 1.5 });
});

test('manual focus overrides the current lock immediately', () => {
  const clock = createFakeClock();
  const controller = createController(clock);

  controller.handleKill(createKillEvent({ systemId: 30000001, iskValue: 20, occurredAt: '2026-04-06T23:00:00Z', sequenceId: 10 }));
  clock.advanceBy(3_000);
  clock.advanceBy(5_000);

  controller.handleKill(createKillEvent({ systemId: 30000003, iskValue: 90, occurredAt: '2026-04-06T23:00:05Z', sequenceId: 12 }));

  assert.equal(
    controller.focusKill(
      createKillEvent({ systemId: 30000002, iskValue: 45, occurredAt: '2026-04-06T23:00:06Z', sequenceId: 13 })
    ),
    true
  );
  assert.equal(controller.isAnimating(), true);
  assert.equal(controller.getActiveKillId(), 13);

  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), { centerX: 0.72, centerY: 0.61, zoom: 1.5 });
  assert.equal(controller.getActiveKillId(), 13);
});

test('disabled camera resets to default and ignores new focus requests until re-enabled', () => {
  const clock = createFakeClock();
  const controller = createController(clock);

  controller.handleKill(createKillEvent({ systemId: 30000001, iskValue: 20, occurredAt: '2026-04-06T23:00:00Z', sequenceId: 10 }));
  clock.advanceBy(3_000);
  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), { centerX: 0.2, centerY: 0.25, zoom: 1.5 });
  assert.equal(controller.setEnabled(false), false);
  assert.equal(controller.isEnabled(), false);
  assert.equal(controller.getActiveKillId(), null);
  assert.equal(controller.isAnimating(), true);
  assertViewport(controller.getViewport(), { centerX: 0.2, centerY: 0.25, zoom: 1.5 });
  assert.equal(
    controller.focusKill(
      createKillEvent({ systemId: 30000002, iskValue: 45, occurredAt: '2026-04-06T23:00:06Z', sequenceId: 13 })
    ),
    false
  );
  clock.advanceBy(5_000);
  assertViewport(controller.getViewport(), DEFAULT_CAMERA);

  assert.equal(controller.setEnabled(true), true);
  controller.focusKill(
    createKillEvent({ systemId: 30000002, iskValue: 45, occurredAt: '2026-04-06T23:00:06Z', sequenceId: 13 })
  );
  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), { centerX: 0.72, centerY: 0.61, zoom: 1.5 });
});

test('idle reset returns to the default camera after the configured idle window', () => {
  const clock = createFakeClock();
  const controller = createController(clock);

  controller.handleKill(createKillEvent({ systemId: 30000002, iskValue: 45, occurredAt: '2026-04-06T23:00:00Z', sequenceId: 11 }));
  clock.advanceBy(3_000);
  clock.advanceBy(5_000);
  clock.advanceBy(54_999);

  assertViewport(controller.getViewport(), { centerX: 0.72, centerY: 0.61, zoom: 1.5 });
  assert.equal(controller.getActiveKillId(), 11);

  clock.advanceBy(1);
  assert.equal(controller.isAnimating(), true);
  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), DEFAULT_CAMERA);
  assert.equal(controller.getActiveKillId(), null);
});

test('reset is deferred while a debounce window is active', () => {
  const clock = createFakeClock();
  const controller = createController(clock);

  controller.handleKill(createKillEvent({ systemId: 30000001, iskValue: 20, occurredAt: '2026-04-06T23:00:00Z', sequenceId: 10 }));
  clock.advanceBy(3_000);
  clock.advanceBy(59_000);

  controller.handleKill(createKillEvent({ systemId: 30000002, iskValue: 45, occurredAt: '2026-04-06T23:01:00Z', sequenceId: 20 }));
  clock.advanceBy(1_000);

  assertViewport(controller.getViewport(), { centerX: 0.2, centerY: 0.25, zoom: 1.5 });

  clock.advanceBy(2_000);
  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), { centerX: 0.72, centerY: 0.61, zoom: 1.5 });
});

test('reset is deferred while a queued post-lock candidate exists', () => {
  const clock = createFakeClock();
  const controller = createController(clock, {
    cameraLockMs: 30_000,
    cameraResetIdleMs: 10_000
  });

  controller.handleKill(createKillEvent({ systemId: 30000001, iskValue: 20, occurredAt: '2026-04-06T23:00:00Z', sequenceId: 10 }));
  clock.advanceBy(3_000);
  clock.advanceBy(5_000);
  controller.handleKill(createKillEvent({ systemId: 30000003, iskValue: 90, occurredAt: '2026-04-06T23:00:10Z', sequenceId: 12 }));
  clock.advanceBy(10_000);

  assertViewport(controller.getViewport(), { centerX: 0.2, centerY: 0.25, zoom: 1.5 });

  clock.advanceBy(15_000);
  clock.advanceBy(5_000);

  assertViewport(controller.getViewport(), { centerX: 0.83, centerY: 0.18, zoom: 1.5 });
});

test('kill ranking is deterministic across isk value, occurrence time, and sequence id', () => {
  const olderHighValue = createKillEvent({
    systemId: 30000001,
    iskValue: 100,
    occurredAt: '2026-04-06T23:00:00Z',
    sequenceId: 10
  });
  const newerHighValue = createKillEvent({
    systemId: 30000002,
    iskValue: 100,
    occurredAt: '2026-04-06T23:00:05Z',
    sequenceId: 11
  });
  const newerHigherSequence = createKillEvent({
    systemId: 30000003,
    iskValue: 100,
    occurredAt: '2026-04-06T23:00:05Z',
    sequenceId: 12
  });

  assert.equal(compareKillsByPriority(newerHighValue, olderHighValue) > 0, true);
  assert.equal(compareKillsByPriority(newerHigherSequence, newerHighValue) > 0, true);
  assert.equal(compareKillsByPriority(olderHighValue, newerHigherSequence) < 0, true);
});

function createController(clock, overrides = {}) {
  return createKillFocusController({
    systems: SYSTEMS,
    cameraZoomScale: 1.5,
    cameraMoveDurationMs: 5_000,
    cameraLockMs: 30_000,
    cameraResetIdleMs: 60_000,
    cameraSelectionDebounceMs: 3_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides
  });
}

function createKillEvent({ systemId, iskValue, occurredAt, sequenceId, killId = sequenceId }) {
  return {
    killId,
    systemId,
    iskValue,
    occurredAt,
    sequenceId
  };
}

function createFakeClock() {
  let currentTime = 0;
  let nextTimerId = 1;
  const timers = new Map();

  return {
    now: () => currentTime,
    setTimer(callback, delay) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        callback,
        dueAt: currentTime + delay
      });
      return timerId;
    },
    clearTimer(timerId) {
      timers.delete(timerId);
    },
    advanceBy(durationMs) {
      const targetTime = currentTime + durationMs;

      while (true) {
        const nextTimer = getNextTimer(timers, targetTime);
        if (!nextTimer) {
          break;
        }

        currentTime = nextTimer.dueAt;
        timers.delete(nextTimer.timerId);
        nextTimer.callback();
      }

      currentTime = targetTime;
    }
  };
}

function getNextTimer(timers, targetTime) {
  let soonestTimer = null;

  for (const [timerId, timer] of timers.entries()) {
    if (timer.dueAt > targetTime) {
      continue;
    }

    if (!soonestTimer || timer.dueAt < soonestTimer.dueAt) {
      soonestTimer = { timerId, ...timer };
    }
  }

  return soonestTimer;
}

function assertViewport(actual, expected) {
  assert.equal(roundViewportValue(actual.centerX), roundViewportValue(expected.centerX));
  assert.equal(roundViewportValue(actual.centerY), roundViewportValue(expected.centerY));
  assert.equal(roundViewportValue(actual.zoom), roundViewportValue(expected.zoom));
}

function roundViewportValue(value) {
  return Number(value.toFixed(4));
}

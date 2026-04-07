import { DEFAULT_CAMERA } from './render/projection.js';

export function createKillFocusController({
  systems,
  cameraZoomScale,
  cameraMoveDurationMs,
  cameraLockMs,
  cameraResetIdleMs,
  cameraSelectionDebounceMs,
  enabled = true,
  now = () => performance.now(),
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timerId) => window.clearTimeout(timerId),
  onChange = () => {}
}) {
  const systemsById = new Map(systems.map((system) => [system.id, system]));
  const state = {
    viewport: { ...DEFAULT_CAMERA },
    animation: null,
    debounceCandidate: null,
    debounceTimerId: null,
    queuedCandidate: null,
    lockUntil: 0,
    lockTimerId: null,
    resetTimerId: null,
    pendingReset: false,
    activeTarget: 'default',
    activeKillId: null,
    enabled: enabled !== false
  };

  return {
    handleKill(killEvent) {
      if (!state.enabled) {
        return;
      }

      const system = systemsById.get(killEvent.systemId);
      if (!system) {
        return;
      }

      const currentNow = now();
      flushLockIfExpired(currentNow);
      syncAnimation(currentNow);

      const candidate = {
        killEvent,
        viewport: {
          centerX: system.x,
          centerY: system.y,
          zoom: cameraZoomScale
        }
      };

      if (state.debounceCandidate) {
        state.debounceCandidate = pickPreferredCandidate(state.debounceCandidate, candidate);
        return;
      }

      if (state.lockUntil > currentNow) {
        state.queuedCandidate = pickPreferredCandidate(state.queuedCandidate, candidate);
        return;
      }

      startDebounce(candidate, currentNow);
    },
    focusKill(killEvent) {
      if (!state.enabled) {
        return false;
      }

      const system = systemsById.get(killEvent.systemId);
      if (!system) {
        return false;
      }

      const currentNow = now();
      flushLockIfExpired(currentNow);
      syncAnimation(currentNow);
      clearManagedTimer('debounceTimerId');
      clearManagedTimer('lockTimerId');
      clearManagedTimer('resetTimerId');
      state.debounceCandidate = null;
      state.queuedCandidate = null;
      state.lockUntil = 0;
      state.pendingReset = false;

      executeKillTarget(
        {
          killEvent,
          viewport: {
            centerX: system.x,
            centerY: system.y,
            zoom: cameraZoomScale
          }
        },
        currentNow
      );

      return true;
    },
    setEnabled(nextEnabled) {
      const normalized = nextEnabled !== false;
      if (state.enabled === normalized) {
        return normalized;
      }

      state.enabled = normalized;
      resetStateForModeChange();

      if (!normalized) {
        animateToDefaultViewport();
      }

      onChange();
      return normalized;
    },
    isEnabled() {
      return state.enabled;
    },
    getActiveKillId() {
      return state.activeKillId;
    },
    getViewport(viewportNow = now()) {
      return { ...syncAnimation(viewportNow) };
    },
    isAnimating(viewportNow = now()) {
      syncAnimation(viewportNow);
      return state.animation !== null;
    },
    destroy() {
      clearManagedTimer('debounceTimerId');
      clearManagedTimer('lockTimerId');
      clearManagedTimer('resetTimerId');
    }
  };

  function resetStateForModeChange() {
    clearManagedTimer('debounceTimerId');
    clearManagedTimer('lockTimerId');
    clearManagedTimer('resetTimerId');
    state.debounceCandidate = null;
    state.queuedCandidate = null;
    state.lockUntil = 0;
    state.pendingReset = false;
    state.activeTarget = 'default';
    state.activeKillId = null;
  }

  function animateToDefaultViewport() {
    const currentNow = now();
    const currentViewport = syncAnimation(currentNow);

    if (isDefaultViewport(currentViewport) && !state.animation) {
      state.viewport = { ...DEFAULT_CAMERA };
      return;
    }

    startAnimation(DEFAULT_CAMERA, currentNow);
  }

  function startDebounce(candidate, currentNow) {
    clearManagedTimer('debounceTimerId');
    state.debounceCandidate = candidate;
    state.debounceTimerId = setTimer(() => finalizeDebounce(), cameraSelectionDebounceMs);
    state.pendingReset = false;
    syncAnimation(currentNow);
  }

  function finalizeDebounce() {
    clearManagedTimer('debounceTimerId');
    const currentNow = now();
    const candidate = state.debounceCandidate;
    state.debounceCandidate = null;

    if (!candidate) {
      if (state.pendingReset) {
        executeReset(currentNow);
      }
      return;
    }

    executeKillTarget(candidate, currentNow);
  }

  function executeKillTarget(candidate, currentNow) {
    state.activeTarget = 'kill';
    state.activeKillId = candidate.killEvent.killId ?? null;
    state.pendingReset = false;
    startAnimation(candidate.viewport, currentNow);
    scheduleLock(currentNow);
    scheduleReset();
  }

  function executeReset(currentNow) {
    if (state.activeTarget === 'default' && !state.animation) {
      state.pendingReset = false;
      return;
    }

    state.activeTarget = 'default';
    state.activeKillId = null;
    state.pendingReset = false;
    startAnimation(DEFAULT_CAMERA, currentNow);
    clearManagedTimer('resetTimerId');
  }

  function startAnimation(targetViewport, currentNow) {
    const startViewport = syncAnimation(currentNow);
    state.animation = {
      from: startViewport,
      to: targetViewport,
      startedAt: currentNow,
      endsAt: currentNow + cameraMoveDurationMs
    };
    onChange();
  }

  function scheduleLock(currentNow) {
    clearManagedTimer('lockTimerId');
    state.lockUntil = currentNow + cameraLockMs;
    state.lockTimerId = setTimer(() => finalizeLock(), cameraLockMs);
  }

  function finalizeLock() {
    clearManagedTimer('lockTimerId');
    const currentNow = now();
    state.lockUntil = 0;

    if (state.queuedCandidate) {
      const candidate = state.queuedCandidate;
      state.queuedCandidate = null;
      executeKillTarget(candidate, currentNow);
      return;
    }

    if (state.pendingReset) {
      executeReset(currentNow);
    }
  }

  function flushLockIfExpired(currentNow) {
    if (state.lockUntil === 0 || currentNow < state.lockUntil) {
      return;
    }

    finalizeLock();
  }

  function scheduleReset() {
    clearManagedTimer('resetTimerId');
    state.resetTimerId = setTimer(() => finalizeResetWait(), cameraResetIdleMs);
  }

  function finalizeResetWait() {
    clearManagedTimer('resetTimerId');
    const currentNow = now();

    if (state.debounceCandidate || state.queuedCandidate) {
      state.pendingReset = true;
      return;
    }

    executeReset(currentNow);
  }

  function syncAnimation(currentNow) {
    if (!state.animation) {
      return state.viewport;
    }

    const progress = Math.min(
      1,
      Math.max(0, (currentNow - state.animation.startedAt) / cameraMoveDurationMs)
    );
    const eased = easeInOutCubic(progress);
    state.viewport = interpolateViewport(state.animation.from, state.animation.to, eased);

    if (progress >= 1) {
      state.animation = null;
    }

    return state.viewport;
  }

  function clearManagedTimer(key) {
    if (state[key] === null) {
      return;
    }

    clearTimer(state[key]);
    state[key] = null;
  }
}

export function compareKillsByPriority(leftKillEvent, rightKillEvent) {
  return (
    compareNumber(normalizeIsk(leftKillEvent), normalizeIsk(rightKillEvent))
    || compareNumber(parseOccurredAt(leftKillEvent), parseOccurredAt(rightKillEvent))
    || compareNumber(normalizeSequence(leftKillEvent), normalizeSequence(rightKillEvent))
  );
}

function pickPreferredCandidate(leftCandidate, rightCandidate) {
  if (!leftCandidate) {
    return rightCandidate;
  }

  if (!rightCandidate) {
    return leftCandidate;
  }

  return compareKillsByPriority(leftCandidate.killEvent, rightCandidate.killEvent) >= 0
    ? leftCandidate
    : rightCandidate;
}

function interpolateViewport(from, to, progress) {
  return {
    centerX: interpolateNumber(from.centerX, to.centerX, progress),
    centerY: interpolateNumber(from.centerY, to.centerY, progress),
    zoom: interpolateNumber(from.zoom, to.zoom, progress)
  };
}

function interpolateNumber(from, to, progress) {
  return from + (to - from) * progress;
}

function easeInOutCubic(progress) {
  if (progress < 0.5) {
    return 4 * progress * progress * progress;
  }

  return 1 - ((-2 * progress + 2) ** 3) / 2;
}

function normalizeIsk(killEvent) {
  return Number.isFinite(killEvent?.iskValue) ? killEvent.iskValue : 0;
}

function parseOccurredAt(killEvent) {
  const occurredAt = Date.parse(killEvent?.occurredAt);
  return Number.isFinite(occurredAt) ? occurredAt : 0;
}

function normalizeSequence(killEvent) {
  return Number.isFinite(killEvent?.sequenceId) ? killEvent.sequenceId : 0;
}

function compareNumber(left, right) {
  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

function isDefaultViewport(viewport) {
  return (
    viewport.centerX === DEFAULT_CAMERA.centerX
    && viewport.centerY === DEFAULT_CAMERA.centerY
    && viewport.zoom === DEFAULT_CAMERA.zoom
  );
}

export { DEFAULT_CAMERA };

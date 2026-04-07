export function createRuntimeState(config) {
  const activityWindowMs = config.display.activityWindowMs;
  const maxRecentKills = config.display.maxRecentKills;

  const state = {
    recentKills: [],
    activityBySystem: new Map(),
    currentSequence: 0
  };

  function pruneExpired(now = Date.now()) {
    const cutoff = now - activityWindowMs;
    for (const [systemId, timestamps] of state.activityBySystem.entries()) {
      const remaining = timestamps.filter((timestamp) => timestamp >= cutoff);
      if (remaining.length === 0) {
        state.activityBySystem.delete(systemId);
        continue;
      }

      remaining.sort((left, right) => left - right);
      state.activityBySystem.set(systemId, remaining);
    }
  }

  function addRecentKill(killEvent) {
    state.recentKills.unshift(killEvent);
    if (state.recentKills.length > maxRecentKills) {
      state.recentKills.length = maxRecentKills;
    }
  }

  function addActivity(killEvent, now = Date.now()) {
    const occurredAtMs = Date.parse(killEvent.occurredAt);
    if (!Number.isFinite(occurredAtMs) || occurredAtMs < now - activityWindowMs) {
      return false;
    }

    const existing = state.activityBySystem.get(killEvent.systemId) ?? [];
    existing.push(occurredAtMs);
    existing.sort((left, right) => left - right);
    state.activityBySystem.set(killEvent.systemId, existing);
    return true;
  }

  return {
    applyKill(killEvent, now = Date.now()) {
      pruneExpired(now);
      addRecentKill(killEvent);
      const addedToActivity = addActivity(killEvent, now);
      state.currentSequence = Math.max(state.currentSequence, killEvent.sequenceId);
      return {
        addedToActivity,
        nextExpirationAt: this.getNextExpirationAt(now)
      };
    },
    advanceSequence(sequenceId) {
      state.currentSequence = Math.max(state.currentSequence, sequenceId);
    },
    pruneExpired,
    getNextExpirationAt(now = Date.now()) {
      pruneExpired(now);
      let nextExpirationAt = null;
      for (const timestamps of state.activityBySystem.values()) {
        if (!timestamps.length) {
          continue;
        }

        const candidate = timestamps[0] + activityWindowMs;
        if (candidate > now && (nextExpirationAt === null || candidate < nextExpirationAt)) {
          nextExpirationAt = candidate;
        }
      }

      return nextExpirationAt;
    },
    getBootstrapState(now = Date.now()) {
      pruneExpired(now);
      return {
        recentKills: [...state.recentKills],
        activityBySystem: Object.fromEntries(
          [...state.activityBySystem.entries()].map(([systemId, timestamps]) => [
            String(systemId),
            [...timestamps]
          ])
        ),
        currentSequence: state.currentSequence
      };
    },
    getCurrentSequence() {
      return state.currentSequence;
    }
  };
}

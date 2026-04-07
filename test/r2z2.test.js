import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2Z2Ingestor } from '../src/server/r2z2.js';

test('ingestor jumps to the latest published sequence after repeated missing polls', async () => {
  const appliedKills = [];
  const writes = [];
  const warnings = [];
  let currentSequence = 0;
  let processedKill = null;
  let processedKillResolve;
  const processedKillPromise = new Promise((resolve) => {
    processedKillResolve = resolve;
  });

  const config = createConfig({
    maxConsecutiveMissingBeforeSkip: 2,
    maxConsecutiveRetryBeforeSkip: 2
  });

  const state = {
    applyKill(killEvent) {
      appliedKills.push(killEvent);
      processedKill = killEvent;
      processedKillResolve();
    },
    advanceSequence(sequence) {
      currentSequence = Math.max(currentSequence, sequence);
    },
    getCurrentSequence() {
      return currentSequence;
    }
  };

  const fetchCounts = new Map();
  let sequenceUrlRequests = 0;
  const ingestor = createR2Z2Ingestor({
    config,
    state,
    sseHub: createSseHubStub(),
    mapData: createMapDataStub(),
    logger: createLogger(warnings),
    fetchImpl: async (url) => {
      fetchCounts.set(url, (fetchCounts.get(url) ?? 0) + 1);

      if (url === config.r2z2.sequenceUrl) {
        sequenceUrlRequests += 1;
        return createJsonResponse({ sequence: sequenceUrlRequests === 1 ? 10 : 12 });
      }

      if (url === `${config.r2z2.baseUrl}/10.json`) {
        return createStatusResponse(404);
      }

      if (url === `${config.r2z2.baseUrl}/12.json`) {
        return createJsonResponse(createKillPayload(12, 120012));
      }

      if (url.startsWith(config.r2z2.baseUrl) && url.endsWith('.json')) {
        return createStatusResponse(404);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
    sleepImpl: sleepBriefly,
    readSequenceStateImpl: async () => null,
    writeSequenceStateImpl: async (_filePath, sequenceState) => {
      writes.push(sequenceState);
    },
    createNameResolver: () => ({
      async enrichKillEvent(killEvent) {
        return killEvent;
      }
    })
  });

  await ingestor.start();
  await processedKillPromise;
  await waitFor(() => ingestor.getStatus().lastProcessedSequence === 12);
  await ingestor.stop();

  const status = ingestor.getStatus();

  assert.equal(appliedKills.length, 1);
  assert.equal(processedKill.sequenceId, 12);
  assert.equal(currentSequence, 12);
  assert.equal(status.lastProcessedSequence, 12);
  assert.equal(status.lastSkipReason, 'missing_sequence');
  assert.equal(status.totalSkippedSequences, 2);
  assert.equal(fetchCounts.get(`${config.r2z2.baseUrl}/10.json`), 2);
  assert.deepEqual(writes, [{ nextSequence: 13, lastProcessedSequence: 12 }]);
  assert.match(
    warnings.find((message) => message.includes('Jumping to latest published sequence')) ?? '',
    /latest published sequence 12/
  );
});

test('ingestor fails open on enrichment and sequence persistence errors', async () => {
  const appliedKills = [];
  const warnings = [];
  let currentSequence = 0;
  let processedKillResolve;
  const processedKillPromise = new Promise((resolve) => {
    processedKillResolve = resolve;
  });

  const config = createConfig({
    maxConsecutiveMissingBeforeSkip: 2,
    maxConsecutiveRetryBeforeSkip: 2
  });

  const state = {
    applyKill(killEvent) {
      appliedKills.push(killEvent);
      processedKillResolve();
    },
    advanceSequence(sequence) {
      currentSequence = Math.max(currentSequence, sequence);
    },
    getCurrentSequence() {
      return currentSequence;
    }
  };

  const ingestor = createR2Z2Ingestor({
    config,
    state,
    sseHub: createSseHubStub(),
    mapData: createMapDataStub(),
    logger: createLogger(warnings),
    fetchImpl: async (url) => {
      if (url === config.r2z2.sequenceUrl) {
        return createJsonResponse({ sequence: 20 });
      }

      if (url === `${config.r2z2.baseUrl}/20.json`) {
        return createJsonResponse(createKillPayload(20, 120020));
      }

      if (url.startsWith(config.r2z2.baseUrl) && url.endsWith('.json')) {
        return createStatusResponse(404);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    },
    sleepImpl: sleepBriefly,
    readSequenceStateImpl: async () => null,
    writeSequenceStateImpl: async () => {
      throw new Error('disk full');
    },
    createNameResolver: () => ({
      async enrichKillEvent() {
        throw new Error('esi unavailable');
      }
    })
  });

  await ingestor.start();
  await processedKillPromise;
  await waitFor(() => ingestor.getStatus().lastProcessedSequence === 20);
  await ingestor.stop();

  const status = ingestor.getStatus();

  assert.equal(appliedKills.length, 1);
  assert.equal(appliedKills[0].sequenceId, 20);
  assert.equal(currentSequence, 20);
  assert.equal(status.lastProcessedSequence, 20);
  assert.equal(status.lastErrorKind, 'sequence_persist');
  assert.match(status.lastErrorMessage ?? '', /disk full/);
  assert.match(
    warnings.find((message) => message.includes('Name enrichment failed')) ?? '',
    /esi unavailable/
  );
  assert.match(
    warnings.find((message) => message.includes('Unable to persist R2Z2 sequence 20')) ?? '',
    /disk full/
  );
});

function createConfig(overrides = {}) {
  return {
    r2z2: {
      baseUrl: 'https://example.invalid/r2z2',
      sequenceUrl: 'https://example.invalid/r2z2/sequence.json',
      requestDelayMs: 1,
      emptyDelayMs: 1,
      retryMs: 1,
      timeoutMs: 1000,
      userAgent: 'eve-killmap-test/1.0',
      headers: {},
      sequenceFile: './runtime/test-sequence.json',
      maxConsecutiveMissingBeforeSkip: 2,
      maxConsecutiveRetryBeforeSkip: 2,
      ...overrides
    }
  };
}

function createKillPayload(sequenceId, killmailId) {
  return {
    killmail_id: killmailId,
    sequence_id: sequenceId,
    esi: {
      killmail_time: '2026-04-07T12:00:00Z',
      solar_system_id: 30000142,
      victim: {
        ship_type_id: 587
      }
    },
    zkb: {
      totalValue: 12345
    }
  };
}

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function createStatusResponse(status) {
  return {
    ok: false,
    status,
    async json() {
      return null;
    },
    async text() {
      return '';
    }
  };
}

function createMapDataStub() {
  return {
    systemById: new Map(),
    regionById: new Map()
  };
}

function createSseHubStub() {
  return {
    broadcast() {},
    getClientCount() {
      return 0;
    }
  };
}

function createLogger(warnings) {
  return {
    info() {},
    warn(message) {
      warnings.push(message);
    }
  };
}

async function waitFor(predicate, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Condition was not met in time.');
}

async function sleepBriefly(ms) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

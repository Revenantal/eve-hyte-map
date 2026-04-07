import { normalizeKillEvent } from './normalize.js';
import { createUniverseNameResolver } from './nameResolver.js';
import { readSequenceState, writeSequenceState } from './sequenceStore.js';
import { sleep } from './utils.js';

export function createR2Z2Ingestor({
  config,
  state,
  sseHub,
  mapData,
  logger = console,
  fetchImpl = fetch,
  sleepImpl = sleep,
  readSequenceStateImpl = readSequenceState,
  writeSequenceStateImpl = writeSequenceState,
  createNameResolver = createUniverseNameResolver,
  now = () => Date.now()
}) {
  let running = false;
  let loopPromise = null;
  let latestSequenceHint = null;
  let currentAttempt = null;
  const diagnostics = {
    running: false,
    startedAt: null,
    stoppedAt: null,
    targetSequence: null,
    latestSequenceHint: null,
    lastAttemptAt: null,
    lastAdvanceAt: null,
    lastProcessedAt: null,
    lastProcessedSequence: null,
    lastSkipAt: null,
    lastSkipFromSequence: null,
    lastSkipToSequence: null,
    lastSkipReason: null,
    totalSkippedSequences: 0,
    consecutiveMissing: 0,
    consecutiveRetries: 0,
    lastErrorAt: null,
    lastErrorKind: null,
    lastErrorMessage: null
  };

  const nameResolver = createNameResolver({
    userAgent: config.r2z2.userAgent,
    headers: config.r2z2.headers,
    timeoutMs: config.r2z2.timeoutMs,
    fetchImpl,
    logger
  });

  return {
    async start() {
      if (running) {
        return;
      }

      running = true;
      diagnostics.running = true;
      diagnostics.startedAt ??= now();
      diagnostics.stoppedAt = null;
      loopPromise = runLoop();
      await sleepImpl(0);
    },
    async stop() {
      running = false;
      diagnostics.running = false;
      diagnostics.stoppedAt = now();
      currentAttempt?.abort();
      if (loopPromise) {
        await loopPromise.catch(() => {});
      }
    },
    getStatus(referenceTime = now()) {
      const snapshot = {
        ...diagnostics,
        latestSequenceHint,
        currentSequence: state.getCurrentSequence(),
        msSinceLastAttempt:
          diagnostics.lastAttemptAt === null ? null : Math.max(0, referenceTime - diagnostics.lastAttemptAt),
        msSinceLastAdvance:
          diagnostics.lastAdvanceAt === null ? null : Math.max(0, referenceTime - diagnostics.lastAdvanceAt),
        msSinceLastProcessed:
          diagnostics.lastProcessedAt === null ? null : Math.max(0, referenceTime - diagnostics.lastProcessedAt)
      };

      return snapshot;
    }
  };

  async function runLoop() {
    const startup = await resolveStartSequenceWithRetry();
    let sequence = startup.sequence;
    let allowResumeFallback = startup.loadedFromResume;
    setTargetSequence(sequence);
    resetSequenceIssueCounters();

    while (running) {
      setTargetSequence(sequence);

      try {
        const result = await fetchSequence(sequence);
        if (!running) {
          return;
        }

        if (result.type === 'processed') {
          allowResumeFallback = false;
          recordProcessed(sequence);
          sequence += 1;
          setTargetSequence(sequence);
          resetSequenceIssueCounters();
          await sleepImpl(config.r2z2.requestDelayMs);
          continue;
        }

        if (result.type === 'missing') {
          diagnostics.consecutiveMissing += 1;
          diagnostics.consecutiveRetries = 0;

          if (
            allowResumeFallback &&
            latestSequenceHint !== null &&
            sequence < latestSequenceHint
          ) {
            logger.warn(
              `Saved next sequence ${sequence} is unavailable. Falling back to latest ${latestSequenceHint}.`
            );
            sequence = skipToSequence(sequence, latestSequenceHint, 'resume_gap');
            allowResumeFallback = false;
            continue;
          }

          if (diagnostics.consecutiveMissing >= config.r2z2.maxConsecutiveMissingBeforeSkip) {
            const refreshedLatestSequence = await refreshLatestSequenceSafe(
              `missing sequence ${sequence}`
            );
            if (
              running &&
              Number.isFinite(refreshedLatestSequence) &&
              refreshedLatestSequence > sequence
            ) {
              logger.warn(
                `Sequence ${sequence} stayed missing for ${diagnostics.consecutiveMissing} polls. Jumping to latest published sequence ${refreshedLatestSequence}.`
              );
              sequence = skipToSequence(
                sequence,
                refreshedLatestSequence,
                'missing_sequence'
              );
              allowResumeFallback = false;
              continue;
            }
          }

          await sleepImpl(config.r2z2.emptyDelayMs);
          continue;
        }

        diagnostics.consecutiveRetries += 1;
        diagnostics.consecutiveMissing = 0;

        if (diagnostics.consecutiveRetries >= config.r2z2.maxConsecutiveRetryBeforeSkip) {
          const refreshedLatestSequence = await refreshLatestSequenceSafe(
            `retrying sequence ${sequence}`
          );
          const nextSequence =
            Number.isFinite(refreshedLatestSequence) && refreshedLatestSequence > sequence
              ? refreshedLatestSequence
              : sequence + 1;

          logger.warn(
            `Skipping past sequence ${sequence} after ${diagnostics.consecutiveRetries} consecutive retries (${result.reason}). Next target is ${nextSequence}.`
          );
          sequence = skipToSequence(sequence, nextSequence, result.reason);
          allowResumeFallback = false;
          await sleepImpl(config.r2z2.requestDelayMs);
          continue;
        }

        await sleepImpl(result.retryMs);
      } catch (error) {
        recordError('loop_exception', `Unexpected R2Z2 loop failure: ${error.message}`);
        logger.warn(`Unexpected R2Z2 loop failure: ${error.message}`);
        await sleepImpl(config.r2z2.retryMs);
      }
    }
  }

  async function resolveStartSequence() {
    const latestSequence = await fetchLatestSequence();
    setLatestSequenceHint(latestSequence);

    const savedState = await readSequenceStateImpl(config.r2z2.sequenceFile);
    if (savedState?.lastProcessedSequence) {
      state.advanceSequence(savedState.lastProcessedSequence);
    }

    if (savedState?.nextSequence) {
      logger.info(`Resuming R2Z2 from saved next sequence ${savedState.nextSequence}.`);
      return {
        sequence: savedState.nextSequence,
        loadedFromResume: true
      };
    }

    logger.info(`Starting R2Z2 from latest published sequence ${latestSequence}.`);
    return {
      sequence: latestSequence,
      loadedFromResume: false
    };
  }

  async function resolveStartSequenceWithRetry() {
    while (running) {
      try {
        return await resolveStartSequence();
      } catch (error) {
        recordError('startup', `Unable to initialize R2Z2 sequence state: ${error.message}`);
        logger.warn(`Unable to initialize R2Z2 sequence state: ${error.message}`);
        await sleepImpl(Math.max(config.r2z2.retryMs, config.r2z2.emptyDelayMs));
      }
    }

    return {
      sequence: latestSequenceHint ?? 0,
      loadedFromResume: false
    };
  }

  async function fetchLatestSequence() {
    const response = await fetchJson(config.r2z2.sequenceUrl);
    const latestSequence = Number(response?.sequence ?? response?.sequence_id);
    if (!Number.isFinite(latestSequence)) {
      throw new Error('Unable to determine latest R2Z2 sequence from sequence.json.');
    }

    return latestSequence;
  }

  async function refreshLatestSequenceSafe(contextLabel) {
    try {
      const refreshedLatestSequence = await fetchLatestSequence();
      setLatestSequenceHint(refreshedLatestSequence);
      return refreshedLatestSequence;
    } catch (error) {
      recordError(
        'sequence_refresh',
        `Unable to refresh latest sequence while handling ${contextLabel}: ${error.message}`
      );
      logger.warn(
        `Unable to refresh latest sequence while handling ${contextLabel}: ${error.message}`
      );
      return latestSequenceHint;
    }
  }

  async function fetchSequence(sequence) {
    const targetUrl = `${config.r2z2.baseUrl}/${sequence}.json`;

    try {
      currentAttempt = new AbortController();
      const response = await fetchImpl(targetUrl, {
        headers: {
          'User-Agent': config.r2z2.userAgent,
          ...config.r2z2.headers
        },
        signal: AbortSignal.any([
          currentAttempt.signal,
          AbortSignal.timeout(config.r2z2.timeoutMs)
        ])
      });
      markAttempt();
      currentAttempt = null;

      if (response.status === 200) {
        const rawBody = await response.text();
        let payload = null;

        try {
          payload = JSON.parse(rawBody);
        } catch (error) {
          recordError(
            'payload_parse',
            `Skipping malformed JSON payload at sequence ${sequence}: ${error.message}`
          );
          logger.warn(`Skipping malformed JSON payload at sequence ${sequence}: ${error.message}`);
        }

        state.advanceSequence(sequence);
        if (payload) {
          const normalized = normalizeKillEvent(payload, mapData);
          if (normalized) {
            let enriched = normalized;

            try {
              enriched = await nameResolver.enrichKillEvent(normalized);
            } catch (error) {
              recordError(
                'name_enrichment',
                `Name enrichment failed for sequence ${sequence}: ${error.message}`
              );
              logger.warn(`Name enrichment failed for sequence ${sequence}: ${error.message}`);
            }

            try {
              state.applyKill(enriched);
              sseHub.broadcast('kill', enriched);
            } catch (error) {
              recordError(
                'kill_processing',
                `Skipping kill payload at sequence ${sequence}: ${error.message}`
              );
              logger.warn(`Skipping kill payload at sequence ${sequence}: ${error.message}`);
            }
          } else {
            recordError('payload_normalize', `Skipping malformed kill payload at sequence ${sequence}.`);
            logger.warn(`Skipping malformed kill payload at sequence ${sequence}.`);
          }
        }

        await persistSequenceState(sequence);
        return { type: 'processed' };
      }

      if (response.status === 404) {
        return { type: 'missing' };
      }

      if (response.status === 403) {
        recordError(
          'upstream_403',
          `R2Z2 returned 403 for sequence ${sequence}. Check User-Agent and Cloudflare access.`
        );
        logger.warn(
          `R2Z2 returned 403 for sequence ${sequence}. Check User-Agent and Cloudflare access.`
        );
        return {
          type: 'retry',
          reason: 'upstream_403',
          retryMs: Math.max(config.r2z2.emptyDelayMs, config.r2z2.retryMs)
        };
      }

      if (response.status === 429) {
        recordError('upstream_429', `R2Z2 rate-limited sequence ${sequence}. Backing off.`);
        logger.warn(`R2Z2 rate-limited sequence ${sequence}. Backing off.`);
        return {
          type: 'retry',
          reason: 'upstream_429',
          retryMs: Math.max(config.r2z2.emptyDelayMs, config.r2z2.retryMs)
        };
      }

      if (response.status >= 500) {
        recordError(
          'upstream_5xx',
          `R2Z2 upstream error ${response.status} for sequence ${sequence}.`
        );
        logger.warn(`R2Z2 upstream error ${response.status} for sequence ${sequence}.`);
        return { type: 'retry', reason: 'upstream_5xx', retryMs: config.r2z2.retryMs };
      }

      recordError(
        'upstream_unexpected',
        `Unexpected R2Z2 status ${response.status} for sequence ${sequence}.`
      );
      logger.warn(`Unexpected R2Z2 status ${response.status} for sequence ${sequence}.`);
      return { type: 'retry', reason: 'upstream_unexpected', retryMs: config.r2z2.retryMs };
    } catch (error) {
      markAttempt();
      if (!running) {
        return { type: 'retry', reason: 'shutdown', retryMs: config.r2z2.retryMs };
      }

      recordError('request_failed', `R2Z2 request failed for sequence ${sequence}: ${error.message}`);
      logger.warn(`R2Z2 request failed for sequence ${sequence}: ${error.message}`);
      return { type: 'retry', reason: 'request_failed', retryMs: config.r2z2.retryMs };
    } finally {
      currentAttempt = null;
    }
  }

  async function persistSequenceState(sequence) {
    try {
      await writeSequenceStateImpl(config.r2z2.sequenceFile, {
        nextSequence: sequence + 1,
        lastProcessedSequence: sequence
      });
    } catch (error) {
      recordError(
        'sequence_persist',
        `Unable to persist R2Z2 sequence ${sequence}: ${error.message}`
      );
      logger.warn(`Unable to persist R2Z2 sequence ${sequence}: ${error.message}`);
    }
  }

  async function fetchJson(url) {
    currentAttempt = new AbortController();
    try {
      const response = await fetchImpl(url, {
        headers: {
          'User-Agent': config.r2z2.userAgent,
          ...config.r2z2.headers
        },
        signal: AbortSignal.any([
          currentAttempt.signal,
          AbortSignal.timeout(config.r2z2.timeoutMs)
        ])
      });
      markAttempt();
      currentAttempt = null;

      if (!response.ok) {
        throw new Error(`Request failed for ${url} with status ${response.status}.`);
      }

      return response.json();
    } catch (error) {
      markAttempt();
      throw error;
    } finally {
      currentAttempt = null;
    }
  }

  function setLatestSequenceHint(sequence) {
    latestSequenceHint = sequence;
    diagnostics.latestSequenceHint = sequence;
  }

  function setTargetSequence(sequence) {
    diagnostics.targetSequence = sequence;
  }

  function markAttempt() {
    diagnostics.lastAttemptAt = now();
  }

  function recordProcessed(sequence) {
    const timestamp = now();
    diagnostics.lastAdvanceAt = timestamp;
    diagnostics.lastProcessedAt = timestamp;
    diagnostics.lastProcessedSequence = sequence;
    resetSequenceIssueCounters();
  }

  function recordError(kind, message) {
    diagnostics.lastErrorAt = now();
    diagnostics.lastErrorKind = kind;
    diagnostics.lastErrorMessage = message;
  }

  function resetSequenceIssueCounters() {
    diagnostics.consecutiveMissing = 0;
    diagnostics.consecutiveRetries = 0;
  }

  function skipToSequence(sequence, nextSequence, reason) {
    const safeNextSequence = Math.max(sequence + 1, nextSequence);
    const skippedCount = Math.max(0, safeNextSequence - sequence);
    const timestamp = now();

    state.advanceSequence(safeNextSequence - 1);
    diagnostics.lastAdvanceAt = timestamp;
    diagnostics.lastSkipAt = timestamp;
    diagnostics.lastSkipFromSequence = sequence;
    diagnostics.lastSkipToSequence = safeNextSequence;
    diagnostics.lastSkipReason = reason;
    diagnostics.totalSkippedSequences += skippedCount;
    setLatestSequenceHint(Math.max(latestSequenceHint ?? 0, safeNextSequence));
    setTargetSequence(safeNextSequence);
    resetSequenceIssueCounters();

    return safeNextSequence;
  }
}

import { normalizeKillEvent } from './normalize.js';
import { createUniverseNameResolver } from './nameResolver.js';
import { readSequenceState, writeSequenceState } from './sequenceStore.js';
import { sleep } from './utils.js';

export function createR2Z2Ingestor({ config, state, sseHub, mapData, logger = console }) {
  let running = false;
  let loopPromise = null;
  let latestSequenceHint = null;
  let currentAttempt = null;
  const nameResolver = createUniverseNameResolver({
    userAgent: config.r2z2.userAgent,
    headers: config.r2z2.headers,
    timeoutMs: config.r2z2.timeoutMs,
    logger
  });

  return {
    async start() {
      if (running) {
        return;
      }

      running = true;
      loopPromise = runLoop();
      await sleep(0);
    },
    async stop() {
      running = false;
      currentAttempt?.abort();
      if (loopPromise) {
        await loopPromise.catch(() => {});
      }
    }
  };

  async function runLoop() {
    const startup = await resolveStartSequenceWithRetry();
    let sequence = startup.sequence;
    let allowResumeFallback = startup.loadedFromResume;

    while (running) {
      const result = await fetchSequence(sequence);
      if (!running) {
        return;
      }

      if (result.type === 'processed') {
        allowResumeFallback = false;
        sequence += 1;
        await sleep(config.r2z2.requestDelayMs);
        continue;
      }

      if (result.type === 'missing') {
        if (
          allowResumeFallback &&
          latestSequenceHint !== null &&
          sequence < latestSequenceHint
        ) {
          logger.warn(
            `Saved next sequence ${sequence} is unavailable. Falling back to latest ${latestSequenceHint}.`
          );
          sequence = latestSequenceHint;
          allowResumeFallback = false;
          continue;
        }

        await sleep(config.r2z2.emptyDelayMs);
        continue;
      }

      allowResumeFallback = false;
      await sleep(result.retryMs);
    }
  }

  async function resolveStartSequence() {
    const latestSequence = await fetchLatestSequence();
    latestSequenceHint = latestSequence;

    const savedState = await readSequenceState(config.r2z2.sequenceFile);
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
        logger.warn(`Unable to initialize R2Z2 sequence state: ${error.message}`);
        await sleep(Math.max(config.r2z2.retryMs, config.r2z2.emptyDelayMs));
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

  async function fetchSequence(sequence) {
    const targetUrl = `${config.r2z2.baseUrl}/${sequence}.json`;

    try {
      currentAttempt = new AbortController();
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': config.r2z2.userAgent,
          ...config.r2z2.headers
        },
        signal: AbortSignal.any([
          currentAttempt.signal,
          AbortSignal.timeout(config.r2z2.timeoutMs)
        ])
      });
      currentAttempt = null;

      if (response.status === 200) {
        const rawBody = await response.text();
        let payload = null;

        try {
          payload = JSON.parse(rawBody);
        } catch (error) {
          logger.warn(`Skipping malformed JSON payload at sequence ${sequence}: ${error.message}`);
        }

        state.advanceSequence(sequence);
        if (payload) {
          const normalized = normalizeKillEvent(payload, mapData);
          if (normalized) {
            const enriched = await nameResolver.enrichKillEvent(normalized);
            state.applyKill(enriched);
            sseHub.broadcast('kill', enriched);
          } else {
            logger.warn(`Skipping malformed kill payload at sequence ${sequence}.`);
          }
        }

        await writeSequenceState(config.r2z2.sequenceFile, {
          nextSequence: sequence + 1,
          lastProcessedSequence: sequence
        });

        return { type: 'processed' };
      }

      if (response.status === 404) {
        return { type: 'missing' };
      }

      if (response.status === 403) {
        logger.warn(
          `R2Z2 returned 403 for sequence ${sequence}. Check User-Agent and Cloudflare access.`
        );
        return {
          type: 'retry',
          retryMs: Math.max(config.r2z2.emptyDelayMs, config.r2z2.retryMs)
        };
      }

      if (response.status === 429) {
        logger.warn(`R2Z2 rate-limited sequence ${sequence}. Backing off.`);
        return {
          type: 'retry',
          retryMs: Math.max(config.r2z2.emptyDelayMs, config.r2z2.retryMs)
        };
      }

      if (response.status >= 500) {
        logger.warn(`R2Z2 upstream error ${response.status} for sequence ${sequence}.`);
        return { type: 'retry', retryMs: config.r2z2.retryMs };
      }

      logger.warn(`Unexpected R2Z2 status ${response.status} for sequence ${sequence}.`);
      return { type: 'retry', retryMs: config.r2z2.retryMs };
    } catch (error) {
      if (!running) {
        return { type: 'retry', retryMs: config.r2z2.retryMs };
      }

      logger.warn(`R2Z2 request failed for sequence ${sequence}: ${error.message}`);
      return { type: 'retry', retryMs: config.r2z2.retryMs };
    } finally {
      currentAttempt = null;
    }
  }

  async function fetchJson(url) {
    currentAttempt = new AbortController();
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.r2z2.userAgent,
        ...config.r2z2.headers
      },
      signal: AbortSignal.any([
        currentAttempt.signal,
        AbortSignal.timeout(config.r2z2.timeoutMs)
      ])
    });
    currentAttempt = null;

    if (!response.ok) {
      throw new Error(`Request failed for ${url} with status ${response.status}.`);
    }

    return response.json();
  }
}

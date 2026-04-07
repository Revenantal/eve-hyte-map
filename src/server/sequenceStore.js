import fs from 'node:fs/promises';
import path from 'node:path';
import { fileExists, readJsonFile } from './utils.js';

export async function readSequenceState(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  const parsed = await readJsonFile(filePath);
  if (typeof parsed === 'number') {
    return {
      nextSequence: parsed,
      lastProcessedSequence: parsed - 1
    };
  }

  const nextSequence = Number(parsed?.nextSequence ?? parsed?.sequence);
  const lastProcessedSequence = Number(
    parsed?.lastProcessedSequence ?? parsed?.currentSequence ?? nextSequence - 1
  );

  if (!Number.isFinite(nextSequence)) {
    return null;
  }

  return {
    nextSequence,
    lastProcessedSequence: Number.isFinite(lastProcessedSequence)
      ? lastProcessedSequence
      : nextSequence - 1
  };
}

export async function writeSequenceState(filePath, sequenceState) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempFilePath = `${filePath}.tmp`;
  const payload = `${JSON.stringify(sequenceState, null, 2)}\n`;
  await fs.writeFile(tempFilePath, payload, 'utf8');
  await fs.rename(tempFilePath, filePath);
}

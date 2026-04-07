import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'sde-extract');
const outputDir = path.join(projectRoot, 'data');

const MIN_NORMAL_SYSTEM_ID = 30000001;
const MAX_NORMAL_SYSTEM_ID = 30999999;
const MAP_PADDING = 0.035;

async function readJsonLines(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizePoint(rawX, rawY, bounds) {
  const width = bounds.maxX - bounds.minX || 1;
  const height = bounds.maxY - bounds.minY || 1;
  const scale = Math.max(width, height);
  const offsetX = (scale - width) / 2;
  const offsetY = (scale - height) / 2;
  const paddedSpan = 1 - MAP_PADDING * 2;

  const normalizedX =
    MAP_PADDING + ((rawX - bounds.minX + offsetX) / scale) * paddedSpan;
  const normalizedY =
    MAP_PADDING + ((bounds.maxY - rawY + offsetY) / scale) * paddedSpan;

  return {
    x: Number(normalizedX.toFixed(6)),
    y: Number(normalizedY.toFixed(6))
  };
}

function average(points) {
  if (!points.length) {
    return { x: 0.5, y: 0.5 };
  }

  const totals = points.reduce(
    (accumulator, point) => {
      accumulator.x += point.x;
      accumulator.y += point.y;
      return accumulator;
    },
    { x: 0, y: 0 }
  );

  return {
    x: Number((totals.x / points.length).toFixed(6)),
    y: Number((totals.y / points.length).toFixed(6))
  };
}

async function main() {
  const systemsSource = await readJsonLines(
    path.join(sourceDir, 'mapSolarSystems.jsonl')
  );
  const regionsSource = await readJsonLines(path.join(sourceDir, 'mapRegions.jsonl'));
  const stargatesSource = await readJsonLines(
    path.join(sourceDir, 'mapStargates.jsonl')
  );

  const regionById = new Map(
    regionsSource.map((region) => [
      region._key,
      {
        id: region._key,
        name: region.name?.en ?? String(region._key)
      }
    ])
  );

  const includedSystems = systemsSource.filter((system) => {
    if (system._key < MIN_NORMAL_SYSTEM_ID || system._key > MAX_NORMAL_SYSTEM_ID) {
      return false;
    }

    return regionById.has(system.regionID);
  });

  const bounds = includedSystems.reduce(
    (accumulator, system) => {
      const rawX = system.position2D?.x ?? system.position?.x ?? 0;
      const rawY = system.position2D?.y ?? system.position?.z ?? 0;
      accumulator.minX = Math.min(accumulator.minX, rawX);
      accumulator.maxX = Math.max(accumulator.maxX, rawX);
      accumulator.minY = Math.min(accumulator.minY, rawY);
      accumulator.maxY = Math.max(accumulator.maxY, rawY);
      return accumulator;
    },
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    }
  );

  const normalizedSystems = includedSystems.map((system) => {
    const point = normalizePoint(
      system.position2D?.x ?? system.position?.x ?? 0,
      system.position2D?.y ?? system.position?.z ?? 0,
      bounds
    );

    return {
      id: system._key,
      name: system.name?.en ?? String(system._key),
      x: point.x,
      y: point.y,
      regionId: system.regionID,
      regional: Boolean(system.regional)
    };
  });

  const includedSystemIds = new Set(normalizedSystems.map((system) => system.id));
  const edges = [];
  const seenEdges = new Set();
  const connectedSystemIds = new Set();

  for (const gate of stargatesSource) {
    const fromSystemId = gate.solarSystemID;
    const toSystemId = gate.destination?.solarSystemID;
    if (!includedSystemIds.has(fromSystemId) || !includedSystemIds.has(toSystemId)) {
      continue;
    }

    const low = Math.min(fromSystemId, toSystemId);
    const high = Math.max(fromSystemId, toSystemId);
    const edgeKey = `${low}:${high}`;
    if (seenEdges.has(edgeKey)) {
      continue;
    }

    seenEdges.add(edgeKey);
    edges.push([low, high]);
    connectedSystemIds.add(low);
    connectedSystemIds.add(high);
  }

  const systems = normalizedSystems.filter((system) => connectedSystemIds.has(system.id));
  const systemsByRegion = new Map();
  for (const system of systems) {
    const list = systemsByRegion.get(system.regionId) ?? [];
    list.push(system);
    systemsByRegion.set(system.regionId, list);
  }

  const regions = [...systemsByRegion.entries()]
    .map(([regionId, regionSystems]) => {
      const region = regionById.get(regionId);
      if (!region) {
        return null;
      }

      const centroid = average(regionSystems);
      return {
        id: regionId,
        name: region.name,
        x: centroid.x,
        y: centroid.y
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));

  systems.sort((left, right) => left.id - right.id);
  edges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, 'systems.json'),
    `${JSON.stringify(systems, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(outputDir, 'edges.json'),
    `${JSON.stringify(edges)}\n`
  );
  await fs.writeFile(
    path.join(outputDir, 'regions.json'),
    `${JSON.stringify(regions, null, 2)}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

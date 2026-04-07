import { readJsonFile } from './utils.js';

export async function loadMapData(config) {
  const [systems, edges, regions] = await Promise.all([
    readJsonFile(config.map.systemsPath),
    readJsonFile(config.map.edgesPath),
    readJsonFile(config.map.regionsPath)
  ]);

  const systemById = new Map(systems.map((system) => [system.id, system]));
  const regionById = new Map(regions.map((region) => [region.id, region]));

  return {
    systems,
    edges,
    regions,
    systemById,
    regionById
  };
}

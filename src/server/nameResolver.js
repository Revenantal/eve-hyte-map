const DEFAULT_ESI_NAMES_URL = 'https://esi.evetech.net/latest/universe/names/';
const CATEGORY_BY_KIND = {
  alliance: 'alliance',
  corporation: 'corporation',
  character: 'character',
  ship: 'inventory_type',
  system: 'solar_system'
};

export function createUniverseNameResolver({
  userAgent,
  headers = {},
  timeoutMs = 15000,
  namesUrl = DEFAULT_ESI_NAMES_URL,
  fetchImpl = fetch,
  logger = console
}) {
  const cache = new Map();
  const pending = new Map();

  return {
    async enrichKillEvent(killEvent) {
      const lookups = [];

      if (!killEvent.systemName && Number.isFinite(killEvent.systemId)) {
        lookups.push({ kind: 'system', id: killEvent.systemId });
      }

      if (Number.isFinite(killEvent.victimCharacterId) && needsCharacterName(killEvent.victimName)) {
        lookups.push({ kind: 'character', id: killEvent.victimCharacterId });
      }

      if (
        Number.isFinite(killEvent.victimCorporationId)
        && needsEntityName(killEvent.victimCorporationName)
      ) {
        lookups.push({ kind: 'corporation', id: killEvent.victimCorporationId });
      }

      if (
        Number.isFinite(killEvent.victimAllianceId)
        && needsEntityName(killEvent.victimAllianceName)
      ) {
        lookups.push({ kind: 'alliance', id: killEvent.victimAllianceId });
      }

      if (Number.isFinite(killEvent.shipTypeId) && needsShipName(killEvent.shipName)) {
        lookups.push({ kind: 'ship', id: killEvent.shipTypeId });
      }

      if (!lookups.length) {
        return killEvent;
      }

      const resolvedNames = await resolveLookups(lookups);
      return {
        ...killEvent,
        systemName: resolvedNames.get(cacheKey('system', killEvent.systemId)) ?? killEvent.systemName,
        victimName:
          resolvedNames.get(cacheKey('character', killEvent.victimCharacterId))
          ?? killEvent.victimName,
        victimCorporationName:
          resolvedNames.get(cacheKey('corporation', killEvent.victimCorporationId))
          ?? killEvent.victimCorporationName,
        victimAllianceName:
          resolvedNames.get(cacheKey('alliance', killEvent.victimAllianceId))
          ?? killEvent.victimAllianceName,
        shipName: resolvedNames.get(cacheKey('ship', killEvent.shipTypeId)) ?? killEvent.shipName
      };
    }
  };

  async function resolveLookups(lookups) {
    const results = new Map();
    const missing = [];

    for (const lookup of lookups) {
      const key = cacheKey(lookup.kind, lookup.id);
      if (cache.has(key)) {
        results.set(key, cache.get(key));
        continue;
      }

      if (pending.has(key)) {
        results.set(key, await pending.get(key));
        continue;
      }

      missing.push(lookup);
    }

    if (!missing.length) {
      return results;
    }

    const groupedById = new Map();
    for (const lookup of missing) {
      groupedById.set(lookup.id, lookup);
    }

    const batchPromise = fetchNames([...groupedById.values()]);
    for (const lookup of groupedById.values()) {
      const key = cacheKey(lookup.kind, lookup.id);
      pending.set(
        key,
        batchPromise.then((resolved) => resolved.get(key))
      );
    }

    try {
      const fetchedResults = await batchPromise;
      for (const [key, value] of fetchedResults.entries()) {
        cache.set(key, value);
        results.set(key, value);
      }

      for (const lookup of groupedById.values()) {
        const key = cacheKey(lookup.kind, lookup.id);
        if (!fetchedResults.has(key)) {
          cache.set(key, undefined);
        }
      }
    } finally {
      for (const lookup of groupedById.values()) {
        pending.delete(cacheKey(lookup.kind, lookup.id));
      }
    }

    return results;
  }

  async function fetchNames(lookups) {
    try {
      const response = await fetchImpl(namesUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          ...headers
        },
        body: JSON.stringify(lookups.map((lookup) => lookup.id)),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        logger.warn(
          `ESI name lookup failed with status ${response.status} for ids ${lookups.map((lookup) => lookup.id).join(', ')}.`
        );
        return new Map();
      }

      const payload = await response.json();
      const results = new Map();

      for (const item of payload) {
        const matchingLookup = lookups.find(
          (lookup) =>
            lookup.id === item.id &&
            CATEGORY_BY_KIND[lookup.kind] === item.category
        );

        if (!matchingLookup || !item.name) {
          continue;
        }

        results.set(cacheKey(matchingLookup.kind, matchingLookup.id), item.name);
      }

      return results;
    } catch (error) {
      logger.warn(
        `ESI name lookup failed for ids ${lookups.map((lookup) => lookup.id).join(', ')}: ${error.message}`
      );
      return new Map();
    }
  }
}

function cacheKey(kind, id) {
  return `${kind}:${id}`;
}

function needsShipName(shipName) {
  return !shipName || /^\d+$/.test(shipName);
}

function needsCharacterName(characterName) {
  return !characterName || /^\d+$/.test(characterName);
}

function needsEntityName(entityName) {
  return !entityName || /^\d+$/.test(entityName);
}

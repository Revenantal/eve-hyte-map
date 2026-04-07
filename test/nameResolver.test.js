import test from 'node:test';
import assert from 'node:assert/strict';
import { createUniverseNameResolver } from '../src/server/nameResolver.js';

test('universe name resolver enriches unknown systems and ship type ids', async () => {
  const fetchCalls = [];
  const resolver = createUniverseNameResolver({
    userAgent: 'eve-killmap-test/1.0',
    fetchImpl: async (url, options) => {
      fetchCalls.push({
        url,
        body: options.body
      });

      return {
        ok: true,
        async json() {
          return [
            { id: 31000005, category: 'solar_system', name: 'J123405' },
            { id: 2112345678, category: 'character', name: 'Sonic Rahouni' },
            { id: 98633005, category: 'corporation', name: 'Brave Operations - Lollipop Division' },
            { id: 99011193, category: 'alliance', name: 'Brave Collective' },
            { id: 670, category: 'inventory_type', name: 'Capsule' }
          ];
        }
      };
    }
  });

  const baseKill = {
    systemId: 31000005,
    systemName: undefined,
    victimCharacterId: 2112345678,
    victimName: '2112345678',
    victimCorporationId: 98633005,
    victimCorporationName: '98633005',
    victimAllianceId: 99011193,
    victimAllianceName: '99011193',
    shipTypeId: 670,
    shipName: '670'
  };

  const enriched = await resolver.enrichKillEvent(baseKill);
  const enrichedAgain = await resolver.enrichKillEvent(baseKill);

  assert.equal(enriched.systemName, 'J123405');
  assert.equal(enriched.victimName, 'Sonic Rahouni');
  assert.equal(enriched.victimCorporationName, 'Brave Operations - Lollipop Division');
  assert.equal(enriched.victimAllianceName, 'Brave Collective');
  assert.equal(enriched.shipName, 'Capsule');
  assert.equal(enrichedAgain.systemName, 'J123405');
  assert.equal(enrichedAgain.victimName, 'Sonic Rahouni');
  assert.equal(enrichedAgain.victimCorporationName, 'Brave Operations - Lollipop Division');
  assert.equal(enrichedAgain.victimAllianceName, 'Brave Collective');
  assert.equal(enrichedAgain.shipName, 'Capsule');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://esi.evetech.net/latest/universe/names/');
  assert.equal(fetchCalls[0].body, JSON.stringify([31000005, 2112345678, 98633005, 99011193, 670]));
});

test('universe name resolver fails open when ESI lookup throws', async () => {
  const warnings = [];
  const resolver = createUniverseNameResolver({
    userAgent: 'eve-killmap-test/1.0',
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
    logger: {
      warn(message) {
        warnings.push(message);
      }
    }
  });

  const baseKill = {
    systemId: 31000005,
    systemName: undefined,
    victimCharacterId: 2112345678,
    victimName: '2112345678',
    shipTypeId: 670,
    shipName: '670'
  };

  const enriched = await resolver.enrichKillEvent(baseKill);

  assert.equal(enriched.systemId, baseKill.systemId);
  assert.equal(enriched.systemName, undefined);
  assert.equal(enriched.victimCharacterId, baseKill.victimCharacterId);
  assert.equal(enriched.victimName, baseKill.victimName);
  assert.equal(enriched.shipTypeId, baseKill.shipTypeId);
  assert.equal(enriched.shipName, baseKill.shipName);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /socket hang up/);
});

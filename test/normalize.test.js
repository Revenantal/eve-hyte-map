import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKillEvent } from '../src/server/normalize.js';

test('normalizeKillEvent accepts current R2Z2 payloads that embed the raw killmail under esi', () => {
  const payload = {
    killmail_id: 134555376,
    hash: '0aa05123ee1f9185591d75ce5bb821e299f7084c',
    esi: {
      killmail_id: 134555376,
      killmail_time: '2026-04-06T23:29:45Z',
      solar_system_id: 30005196,
      victim: {
        character_id: 2113216474,
        corporation_id: 98633005,
        alliance_id: 99011193,
        ship_type_id: 73796
      }
    },
    zkb: {
      totalValue: 53444768.48
    },
    uploaded_at: 1775518316,
    sequence_id: 96807924
  };

  const mapData = {
    systemById: new Map([
      [30005196, { id: 30005196, name: 'O9X-CV', regionId: 10000061 }]
    ]),
    regionById: new Map([[10000061, { id: 10000061, name: 'Tenerifis' }]])
  };

  const normalized = normalizeKillEvent(payload, mapData);

  assert.equal(normalized.sequenceId, 96807924);
  assert.equal(normalized.killId, 134555376);
  assert.equal(normalized.systemId, 30005196);
  assert.equal(normalized.systemName, 'O9X-CV');
  assert.equal(normalized.regionName, 'Tenerifis');
  assert.equal(normalized.occurredAt, '2026-04-06T23:29:45Z');
  assert.equal(normalized.iskValue, 53444768.48);
  assert.equal(normalized.victimCharacterId, 2113216474);
  assert.equal(normalized.victimCorporationId, 98633005);
  assert.equal(normalized.victimAllianceId, 99011193);
  assert.equal(normalized.shipTypeId, 73796);
});

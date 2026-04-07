export function normalizeKillEvent(payload, mapData) {
  const killmail = payload?.killmail ?? payload?.esi;
  const sequenceId = Number(payload?.sequence_id);
  const killId = payload?.killmail_id;
  const systemId = Number(killmail?.solar_system_id);
  const occurredAt = killmail?.killmail_time;

  if (!Number.isFinite(sequenceId) || !killId || !Number.isFinite(systemId) || !occurredAt) {
    return null;
  }

  const system = mapData.systemById.get(systemId);
  const region = system ? mapData.regionById.get(system.regionId) : null;
  const uploadedAt = normalizeUploadedAt(payload?.uploaded_at);
  const victim = killmail?.victim;
  const victimCharacterId = victim?.character_id ? Number(victim.character_id) : undefined;
  const victimCorporationId = victim?.corporation_id ? Number(victim.corporation_id) : undefined;
  const victimAllianceId = victim?.alliance_id ? Number(victim.alliance_id) : undefined;
  const shipTypeId = victim?.ship_type_id ? Number(victim.ship_type_id) : undefined;
  const iskValue =
    typeof payload?.zkb?.totalValue === 'number'
      ? payload.zkb.totalValue
      : Number(payload?.zkb?.totalValue) || undefined;

  return {
    sequenceId,
    killId,
    hash: payload?.hash,
    systemId,
    systemName: system?.name,
    regionId: system?.regionId,
    regionName: region?.name,
    occurredAt,
    uploadedAt,
    iskValue,
    victimCharacterId,
    victimCorporationId,
    victimAllianceId,
    shipTypeId,
    victimName: victim?.character_id ? String(victim.character_id) : undefined,
    victimCorporationName: victim?.corporation_id ? String(victim.corporation_id) : undefined,
    victimAllianceName: victim?.alliance_id ? String(victim.alliance_id) : undefined,
    shipName: victim?.ship_type_id ? String(victim.ship_type_id) : undefined
  };
}

function normalizeUploadedAt(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return numericValue < 1e12 ? numericValue * 1000 : numericValue;
}

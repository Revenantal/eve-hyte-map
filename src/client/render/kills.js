const iskFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1
});

export function renderKillsList(container, recentKills) {
  container.innerHTML = '';

  if (!recentKills.length) {
    const item = document.createElement('li');
    item.className = 'kill-empty';
    item.textContent = 'Waiting for the first kill event.';
    container.append(item);
    return;
  }

  for (const killEvent of recentKills) {
    const item = document.createElement('li');
    item.className = 'kill-row';

    item.append(
      createValueRail(killEvent),
      createShipThumb(killEvent),
      createVictimBlock(killEvent),
      createAllianceThumb(killEvent),
      createMetaBlock(killEvent),
      createLocationBlock(killEvent)
    );

    container.append(item);
  }
}

function createValueRail(killEvent) {
  const rail = document.createElement('div');
  rail.className = 'kill-rail';

  const time = document.createElement('div');
  time.className = 'kill-time';
  time.textContent = formatClockTime(killEvent.occurredAt);

  const value = document.createElement('div');
  value.className = 'kill-value';
  value.textContent = formatIsk(killEvent.iskValue);

  rail.append(time, value);
  return rail;
}

function createShipThumb(killEvent) {
  const ship = document.createElement('div');
  ship.className = 'kill-ship';

  const image = document.createElement('img');
  image.className = 'kill-ship-image';
  image.alt = formatShipLabel(killEvent);
  image.loading = 'lazy';
  image.src = getShipImageUrl(killEvent);
  image.addEventListener('error', () => {
    image.removeAttribute('src');
    ship.classList.add('kill-thumb-fallback');
    ship.textContent = formatShipInitials(killEvent);
  }, { once: true });

  ship.append(image);
  return ship;
}

function createAllianceThumb(killEvent) {
  const alliance = document.createElement('div');
  alliance.className = 'kill-alliance';

  const image = document.createElement('img');
  image.className = 'kill-alliance-image';
  image.alt = formatAllianceLabel(killEvent);
  image.loading = 'lazy';
  image.src = getAllianceImageUrl(killEvent);
  image.addEventListener('error', () => {
    image.removeAttribute('src');
    alliance.classList.add('kill-thumb-fallback');
    alliance.textContent = formatAllianceInitials(killEvent);
  }, { once: true });

  alliance.append(image);
  return alliance;
}

function createLocationBlock(killEvent) {
  const block = document.createElement('div');
  block.className = 'kill-block kill-location-block';

  const primary = document.createElement('div');
  primary.className = 'kill-primary';
  primary.textContent = formatLocationLabel(killEvent);

  const secondary = document.createElement('div');
  secondary.className = 'kill-secondary';
  secondary.textContent = killEvent.regionName ?? `Region ${killEvent.regionId ?? 'Unknown'}`;

  block.append(primary, secondary);
  return block;
}

function createVictimBlock(killEvent) {
  const block = document.createElement('div');
  block.className = 'kill-block kill-victim-block';

  const primary = document.createElement('div');
  primary.className = 'kill-primary';
  primary.textContent = formatVictimLabel(killEvent);

  const secondary = document.createElement('div');
  secondary.className = 'kill-secondary';
  secondary.textContent = formatShipLabel(killEvent);

  block.append(primary, secondary);
  return block;
}

function createMetaBlock(killEvent) {
  const block = document.createElement('div');
  block.className = 'kill-block kill-meta-block';

  const primary = document.createElement('div');
  primary.className = 'kill-primary';
  primary.textContent = formatCorporationLabel(killEvent);

  const secondary = document.createElement('div');
  secondary.className = 'kill-secondary';
  secondary.textContent = formatAllianceLabel(killEvent);

  block.append(primary, secondary);
  return block;
}

function formatClockTime(occurredAt) {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp)) {
    return '--:--';
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  });
}

function formatRelativeTime(msAgo) {
  if (!Number.isFinite(msAgo) || msAgo < 0) {
    return 'time unknown';
  }
  if (msAgo < 60_000) {
    return 'just now';
  }
  if (msAgo < 3_600_000) {
    return `${Math.round(msAgo / 60_000)}m ago`;
  }
  if (msAgo < 86_400_000) {
    return `${Math.round(msAgo / 3_600_000)}h ago`;
  }
  return `${Math.round(msAgo / 86_400_000)}d ago`;
}

function formatIsk(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'ISK ?';
  }

  return `${iskFormatter.format(value)}`;
}

function formatLocationLabel(killEvent) {
  const system = killEvent.systemName ?? `System ${killEvent.systemId}`;
  const count = getSystemCount(killEvent);
  return count ? `${system} (${count})` : system;
}

function formatVictimLabel(killEvent) {
  if (killEvent.victimName && !/^\d+$/.test(killEvent.victimName)) {
    return killEvent.victimName;
  }

  if (killEvent.victimCharacterId) {
    return `Pilot ${String(killEvent.victimCharacterId).slice(-8)}`;
  }

  return 'Unknown Pilot';
}

function formatShipLabel(killEvent) {
  if (killEvent.shipName && !/^\d+$/.test(killEvent.shipName)) {
    return killEvent.shipName;
  }

  if (killEvent.shipTypeId) {
    return `Ship Type ${killEvent.shipTypeId}`;
  }

  return 'Unknown Ship';
}

function formatCorporationLabel(killEvent) {
  if (
    killEvent.victimCorporationName
    && !/^\d+$/.test(killEvent.victimCorporationName)
  ) {
    return killEvent.victimCorporationName;
  }

  if (killEvent.victimCorporationId) {
    return `Corp ${killEvent.victimCorporationId}`;
  }

  return `Kill ${killEvent.killId}`;
}

function formatAllianceLabel(killEvent) {
  if (
    killEvent.victimAllianceName
    && !/^\d+$/.test(killEvent.victimAllianceName)
  ) {
    return killEvent.victimAllianceName;
  }

  if (killEvent.victimAllianceId) {
    return `Alliance ${killEvent.victimAllianceId}`;
  }

  return formatRelativeTime(Date.now() - Date.parse(killEvent.occurredAt));
}

function formatShipInitials(killEvent) {
  return formatShipLabel(killEvent)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function formatAllianceInitials(killEvent) {
  return formatAllianceLabel(killEvent)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function getShipImageUrl(killEvent) {
  if (!killEvent.shipTypeId) {
    return '';
  }

  return `https://images.evetech.net/types/${killEvent.shipTypeId}/icon?size=64`;
}

function getAllianceImageUrl(killEvent) {
  if (killEvent.victimAllianceId) {
    return `https://images.evetech.net/alliances/${killEvent.victimAllianceId}/logo?size=64`;
  }

  if (killEvent.victimCorporationId) {
    return `https://images.evetech.net/corporations/${killEvent.victimCorporationId}/logo?size=64`;
  }

  return '';
}

function getSystemCount(killEvent) {
  if (typeof killEvent.systemCount !== 'number' || Number.isNaN(killEvent.systemCount)) {
    return '';
  }

  return killEvent.systemCount;
}

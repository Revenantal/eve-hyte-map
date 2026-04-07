export function drawHeatmap(context, systemsById, activityBySystem, tiers, visualScale = 1) {
  const orderedTiers = [...tiers].sort((left, right) => left.min - right.min);

  for (const [systemId, timestamps] of Object.entries(activityBySystem)) {
    const system = systemsById.get(Number(systemId));
    if (!system || !timestamps.length) {
      continue;
    }

    const tier = findTier(orderedTiers, timestamps.length);
    const radius = tier.radius * 6 * visualScale;
    const gradient = context.createRadialGradient(
      system.canvasX,
      system.canvasY,
      0,
      system.canvasX,
      system.canvasY,
      radius
    );
    gradient.addColorStop(0, `rgba(132, 24, 24, ${tier.alpha * 0.8})`);
    gradient.addColorStop(0.5, `rgba(164, 32, 32, ${tier.alpha * 0.36})`);
    gradient.addColorStop(1, 'rgba(132, 24, 24, 0)');

    context.fillStyle = gradient;
    context.beginPath();
    context.arc(system.canvasX, system.canvasY, radius, 0, Math.PI * 2);
    context.fill();
  }
}

export function drawActiveSystemDots(context, systemsById, activityBySystem, visualScale = 1) {
  for (const [systemId, timestamps] of Object.entries(activityBySystem)) {
    const system = systemsById.get(Number(systemId));
    if (!system || !timestamps.length) {
      continue;
    }

    const glowRadius = 10 * visualScale;
    const glow = context.createRadialGradient(
      system.canvasX,
      system.canvasY,
      0,
      system.canvasX,
      system.canvasY,
      glowRadius
    );
    glow.addColorStop(0, 'rgba(128, 18, 18, 0.24)');
    glow.addColorStop(0.45, 'rgba(128, 18, 18, 0.1)');
    glow.addColorStop(1, 'rgba(128, 18, 18, 0)');

    context.fillStyle = glow;
    context.beginPath();
    context.arc(system.canvasX, system.canvasY, glowRadius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = 'rgba(255, 92, 92, 0.95)';
    const dotSize = Math.max(4, Math.round(4 * visualScale));
    const dotOffset = Math.floor(dotSize / 2);
    context.fillRect(system.canvasX - dotOffset, system.canvasY - dotOffset, dotSize, dotSize);
  }
}

function findTier(tiers, count) {
  let activeTier = tiers[0];
  for (const tier of tiers) {
    if (count >= tier.min) {
      activeTier = tier;
    }
  }
  return activeTier;
}

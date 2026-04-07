export function drawPulses(context, systemsById, pulses, pulseDurationMs, visualScale = 1) {
  for (const pulse of pulses) {
    const system = systemsById.get(pulse.systemId);
    if (!system) {
      continue;
    }

    const progress = Math.min(1, (pulse.now - pulse.startedAt) / pulseDurationMs);
    const opacity = 1 - progress;
    const radius = (18 + progress * 34) * visualScale;

    context.lineWidth = (2.2 - progress * 0.9) * visualScale;
    context.strokeStyle = `rgba(114, 221, 255, ${opacity * 0.75})`;
    context.beginPath();
    context.arc(system.canvasX, system.canvasY, radius, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = `rgba(255, 124, 74, ${opacity * 0.5})`;
    context.beginPath();
    context.arc(system.canvasX, system.canvasY, radius * 0.66, 0, Math.PI * 2);
    context.stroke();
  }
}

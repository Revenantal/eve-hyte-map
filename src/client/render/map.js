import { drawActiveSystemDots, drawHeatmap } from './heatmap.js';
import { drawPulses } from './pulse.js';

const DESIGN_WIDTH = 1000;
const DESIGN_HEIGHT = 1360;

export function createMapRenderer(canvas, mapData, renderConfig) {
  const context = canvas.getContext('2d');
  const baseCanvas = document.createElement('canvas');
  const baseContext = baseCanvas.getContext('2d');
  const foregroundCanvas = document.createElement('canvas');
  const foregroundContext = foregroundCanvas.getContext('2d');
  const mapScale = 1;
  let width = 0;
  let height = 0;
  let systemsById = new Map();
  let projection = createProjection(DESIGN_WIDTH, DESIGN_HEIGHT, mapScale);

  context.imageSmoothingEnabled = false;
  baseContext.imageSmoothingEnabled = false;
  foregroundContext.imageSmoothingEnabled = false;

  return {
    resize(nextWidth, nextHeight) {
      const safeWidth = Math.max(1, Math.round(nextWidth));
      const safeHeight = Math.max(1, Math.round(nextHeight));
      if (safeWidth === width && safeHeight === height) {
        return;
      }

      width = safeWidth;
      height = safeHeight;
      canvas.width = width;
      canvas.height = height;
      baseCanvas.width = width;
      baseCanvas.height = height;
      foregroundCanvas.width = width;
      foregroundCanvas.height = height;
      context.imageSmoothingEnabled = false;
      baseContext.imageSmoothingEnabled = false;
      foregroundContext.imageSmoothingEnabled = false;

      projection = createProjection(width, height, mapScale);
      systemsById = new Map(
        mapData.systems.map((system) => [
          system.id,
          {
            ...system,
            ...projection.project(system.x, system.y)
          }
        ])
      );

      drawBaseLayer(baseContext, width, height);
      drawForegroundLayer(foregroundContext, systemsById, mapData);
    },
    render({ activityBySystem, pulses }) {
      if (!width || !height) {
        return;
      }

      context.clearRect(0, 0, width, height);
      context.drawImage(baseCanvas, 0, 0);
      drawHeatmap(context, systemsById, activityBySystem, renderConfig.heatmapTiers);
      context.drawImage(foregroundCanvas, 0, 0);
      drawRegionLabels(context, mapData, projection);
      drawActiveSystemDots(context, systemsById, activityBySystem);
      drawPulses(context, systemsById, pulses, renderConfig.pulseDurationMs);
    }
  };
}

function drawBaseLayer(context, width, height) {
  context.clearRect(0, 0, width, height);
}

function drawForegroundLayer(context, systemsById, mapData) {
  const regionalEdges = [];
  const otherEdges = [];
  for (const [fromSystemId, toSystemId] of mapData.edges) {
    const fromSystem = systemsById.get(fromSystemId);
    const toSystem = systemsById.get(toSystemId);
    if (!fromSystem || !toSystem) {
      continue;
    }

    if (fromSystem.regionId !== toSystem.regionId) {
      regionalEdges.push([fromSystem, toSystem]);
      continue;
    }

    otherEdges.push([fromSystem, toSystem]);
  }

  strokeEdges(context, otherEdges, 'rgba(42, 82, 176, 0.62)', 1);
  strokeEdges(context, regionalEdges, 'rgba(86, 46, 128, 0.26)', 1.15);

  context.fillStyle = 'rgba(255, 255, 255, 0.58)';
  for (const system of systemsById.values()) {
    context.fillRect(system.canvasX - 1, system.canvasY - 1, 2, 2);
  }

}

function drawRegionLabels(context, mapData, projection) {
  context.font = '400 11px "Eve Sans Neue", Bahnschrift, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  context.lineWidth = 3;
  context.fillStyle = 'rgba(255, 255, 255, 0.56)';

  for (const region of mapData.regions) {
    const { canvasX: x, canvasY: y } = projection.project(region.x, region.y);
    context.strokeText(region.name, x, y);
    context.fillText(region.name, x, y);
  }
}

function strokeEdges(context, edges, strokeStyle, lineWidth) {
  if (!edges.length) {
    return;
  }

  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.beginPath();
  for (const [fromSystem, toSystem] of edges) {
    context.moveTo(fromSystem.canvasX, fromSystem.canvasY);
    context.lineTo(toSystem.canvasX, toSystem.canvasY);
  }
  context.stroke();
}

function createProjection(width, height, scale) {
  const fitScale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  const offsetX = Math.round((width - DESIGN_WIDTH * fitScale) / 2);
  const offsetY = Math.round((height - DESIGN_HEIGHT * fitScale) / 2);

  return {
    project(normalizedX, normalizedY) {
      const designX = DESIGN_WIDTH / 2 + (normalizedX * DESIGN_WIDTH - DESIGN_WIDTH / 2) * scale;
      const designY = DESIGN_HEIGHT / 2 + (normalizedY * DESIGN_HEIGHT - DESIGN_HEIGHT / 2) * scale;

      return {
        canvasX: Math.round(offsetX + designX * fitScale),
        canvasY: Math.round(offsetY + designY * fitScale)
      };
    }
  };
}

import { drawActiveSystemDots, drawHeatmap } from './heatmap.js';
import { drawPulses } from './pulse.js';
import { createProjection, DEFAULT_CAMERA } from './projection.js';

const BASE_REGION_LABEL_SIZE_PX = 11;
const BASE_REGION_LABEL_STROKE_PX = 3;
const BASE_SYSTEM_DOT_SIZE_PX = 2;
const BASE_OTHER_EDGE_WIDTH_PX = 1;
const BASE_REGIONAL_EDGE_WIDTH_PX = 1.15;

export function createMapRenderer(canvas, mapData, renderConfig) {
  const context = canvas.getContext('2d');
  let width = 0;
  let height = 0;

  context.imageSmoothingEnabled = false;

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
      context.imageSmoothingEnabled = false;
    },
    render({ activityBySystem, pulses, camera = DEFAULT_CAMERA }) {
      if (!width || !height) {
        return;
      }

      const projection = createProjection(width, height, camera);
      const systemsById = projectSystems(mapData.systems, projection);
      const visualScale = getCameraVisualScale(projection.camera);

      drawBaseLayer(context, width, height);
      drawHeatmap(context, systemsById, activityBySystem, renderConfig.heatmapTiers, visualScale);
      drawForegroundLayer(context, systemsById, mapData, visualScale);
      drawRegionLabels(context, mapData, projection);
      drawActiveSystemDots(context, systemsById, activityBySystem, visualScale);
      drawPulses(context, systemsById, pulses, renderConfig.pulseDurationMs, visualScale);
    }
  };
}

function drawBaseLayer(context, width, height) {
  context.clearRect(0, 0, width, height);
}

function projectSystems(systems, projection) {
  return new Map(
    systems.map((system) => [
      system.id,
      {
        ...system,
        ...projection.project(system.x, system.y)
      }
    ])
  );
}

function drawForegroundLayer(context, systemsById, mapData, visualScale) {
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

  strokeEdges(
    context,
    otherEdges,
    'rgba(42, 82, 176, 0.5)',
    roundToTenth(BASE_OTHER_EDGE_WIDTH_PX * visualScale)
  );
  strokeEdges(
    context,
    regionalEdges,
    'rgba(86, 46, 128, 0.5)',
    roundToTenth(BASE_REGIONAL_EDGE_WIDTH_PX * visualScale)
  );

  context.fillStyle = 'rgba(255, 255, 255, 0.58)';
  const systemDotSize = Math.max(2, Math.round(BASE_SYSTEM_DOT_SIZE_PX * visualScale));
  const systemDotOffset = Math.floor(systemDotSize / 2);
  for (const system of systemsById.values()) {
    context.fillRect(
      system.canvasX - systemDotOffset,
      system.canvasY - systemDotOffset,
      systemDotSize,
      systemDotSize
    );
  }

}

function drawRegionLabels(context, mapData, projection) {
  const labelStyle = getRegionLabelStyle(projection.camera);
  context.font = `400 ${labelStyle.fontSizePx}px "Eve Sans Neue", Bahnschrift, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  context.lineWidth = labelStyle.strokeWidthPx;
  context.fillStyle = 'rgba(255, 255, 255, 0.56)';

  for (const region of mapData.regions) {
    const { canvasX: x, canvasY: y } = projection.project(region.x, region.y);
    context.strokeText(region.name, x, y);
    context.fillText(region.name, x, y);
  }
}

export function getRegionLabelStyle(camera = DEFAULT_CAMERA) {
  const scaledZoom = getCameraVisualScale(camera);

  return {
    fontSizePx: roundToTenth(BASE_REGION_LABEL_SIZE_PX * scaledZoom),
    strokeWidthPx: roundToTenth(BASE_REGION_LABEL_STROKE_PX * scaledZoom)
  };
}

export function getCameraVisualScale(camera = DEFAULT_CAMERA) {
  const zoom = Math.max(1, Number(camera?.zoom) || DEFAULT_CAMERA.zoom);
  return Math.sqrt(zoom);
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

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

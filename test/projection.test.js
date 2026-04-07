import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCamera, createProjection, DEFAULT_CAMERA } from '../src/client/render/projection.js';

test('default projection fits the full map within the canvas', () => {
  const projection = createProjection(1000, 1360, DEFAULT_CAMERA);
  const topLeft = projection.project(0, 0);
  const bottomRight = projection.project(1, 1);

  assert.equal(topLeft.canvasX, 0);
  assert.equal(topLeft.canvasY, 0);
  assert.equal(bottomRight.canvasX, 1000);
  assert.equal(bottomRight.canvasY, 1360);
});

test('focused projection centers the selected system when no clamping is needed', () => {
  const projection = createProjection(1000, 1360, {
    centerX: 0.6,
    centerY: 0.4,
    zoom: 1.5
  });
  const centeredPoint = projection.project(0.6, 0.4);

  assert.equal(centeredPoint.canvasX, 500);
  assert.equal(centeredPoint.canvasY, 680);
});

test('camera clamping prevents blank margins outside the map bounds', () => {
  const camera = clampCamera({
    centerX: 0,
    centerY: 1,
    zoom: 1.5
  });
  const projection = createProjection(1000, 1360, camera);
  const topLeft = projection.project(0, 0);

  assert.equal(Number(camera.centerX.toFixed(4)), 0.3333);
  assert.equal(Number(camera.centerY.toFixed(4)), 0.6667);
  assert.equal(topLeft.canvasX, 0);
  assert.equal(topLeft.canvasY, -680);
});

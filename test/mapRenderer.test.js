import test from 'node:test';
import assert from 'node:assert/strict';
import { getCameraVisualScale, getRegionLabelStyle } from '../src/client/render/map.js';

test('region label style scales up with camera zoom', () => {
  const defaultStyle = getRegionLabelStyle({ zoom: 1 });
  const zoomedStyle = getRegionLabelStyle({ zoom: 4 });

  assert.equal(defaultStyle.fontSizePx, 11);
  assert.equal(defaultStyle.strokeWidthPx, 3);
  assert.equal(zoomedStyle.fontSizePx, 22);
  assert.equal(zoomedStyle.strokeWidthPx, 6);
});

test('region label style clamps invalid zoom to the default size', () => {
  const style = getRegionLabelStyle({ zoom: 0 });

  assert.equal(style.fontSizePx, 11);
  assert.equal(style.strokeWidthPx, 3);
});

test('camera visual scale grows with zoom and clamps invalid zoom', () => {
  assert.equal(getCameraVisualScale({ zoom: 1 }), 1);
  assert.equal(getCameraVisualScale({ zoom: 4 }), 2);
  assert.equal(getCameraVisualScale({ zoom: 0 }), 1);
});

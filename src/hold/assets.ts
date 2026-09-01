import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { HOLD } from './config';

/**
 * Asset loading + sampling. The shapes are the brand identity — they are
 * sampled, never approximated or regenerated.
 */

/**
 * Sample an SVG's single continuous path into `count` points ordered by
 * arc length. Returns points centered on their bounding box, Y flipped to
 * world orientation, scaled so the larger extent equals `size`.
 */
export async function sampleSvgPath(url: string, count: number, size: number): Promise<THREE.Vector2[]> {
  const text = await (await fetch(url)).text();
  const data = new SVGLoader().parse(text);
  const subPaths = data.paths.flatMap((p) => p.subPaths);
  // take the longest subpath defensively — these files each hold one stroke
  let best = subPaths[0];
  let bestLen = -1;
  for (const sp of subPaths) {
    const len = sp.getLength();
    if (len > bestLen) {
      bestLen = len;
      best = sp;
    }
  }
  const raw = best.getSpacedPoints(count);
  if (raw.length > 1 && raw[0].distanceTo(raw[raw.length - 1]) < 1e-6) raw.pop();

  const box = new THREE.Box2().setFromPoints(raw);
  const center = box.getCenter(new THREE.Vector2());
  const extent = box.getSize(new THREE.Vector2());
  const s = size / Math.max(extent.x, extent.y);
  return raw.map((p) => new THREE.Vector2((p.x - center.x) * s, -(p.y - center.y) * s));
}

/**
 * Sample an SVG *and* build its filled geometry under the identical
 * transform, so an outline drawn through the points sits exactly on the
 * boundary of the fill. Used for the resolved mark, which must be the real
 * filled logo rather than a stroked approximation of it.
 */
export async function loadSvgArt(
  url: string,
  count: number,
  size: number,
): Promise<{ points: THREE.Vector2[]; fill: THREE.BufferGeometry }> {
  const text = await (await fetch(url)).text();
  const data = new SVGLoader().parse(text);

  const subPaths = data.paths.flatMap((p) => p.subPaths);
  let best = subPaths[0];
  let bestLen = -1;
  for (const sp of subPaths) {
    const len = sp.getLength();
    if (len > bestLen) {
      bestLen = len;
      best = sp;
    }
  }
  const raw = best.getSpacedPoints(count);
  if (raw.length > 1 && raw[0].distanceTo(raw[raw.length - 1]) < 1e-6) raw.pop();

  const box = new THREE.Box2().setFromPoints(raw);
  const center = box.getCenter(new THREE.Vector2());
  const extent = box.getSize(new THREE.Vector2());
  const s = size / Math.max(extent.x, extent.y);

  const points = raw.map((p) => new THREE.Vector2((p.x - center.x) * s, -(p.y - center.y) * s));

  // same transform for the fill: translate to origin, then scale (Y flipped
  // to match world orientation)
  const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
  const fill = new THREE.ShapeGeometry(shapes);
  fill.translate(-center.x, -center.y, 0);
  fill.scale(s, -s, 1);

  return { points, fill };
}

/**
 * The head's outline state comes from its own vector asset rather than being
 * derived from the filled silhouette (stroking the raster clipped badly).
 * Points are returned normalised so their bounding box is centred on the
 * origin with HEIGHT 1 — the caller scales it by the head's world height, so
 * the outline and the fill land on exactly the same box.
 */
export async function loadOutlinePoints(url: string, count: number): Promise<THREE.Vector2[]> {
  const text = await (await fetch(url)).text();
  const data = new SVGLoader().parse(text);
  const subPaths = data.paths.flatMap((p) => p.subPaths);
  let best = subPaths[0];
  let bestLen = -1;
  for (const sp of subPaths) {
    const len = sp.getLength();
    if (len > bestLen) {
      bestLen = len;
      best = sp;
    }
  }
  const raw = best.getSpacedPoints(count);
  const box = new THREE.Box2().setFromPoints(raw);
  const c = box.getCenter(new THREE.Vector2());
  const size = box.getSize(new THREE.Vector2());
  const sy = 1 / size.y;
  const sx = 1 / size.y; // uniform: keep the artwork's own proportions
  void sx;
  return raw.map((p) => new THREE.Vector2((p.x - c.x) * sy, -(p.y - c.y) * sy));
}

/**
 * The head ships as a raster silhouette (head.png), rendered on a plane with
 * a shader that EMPTIES it as the thought is dragged out:
 *
 *   uStrokeIn  0 -> 1   the outline snaps in at the start of the drag
 *   uDrain     0 -> 1   a soft-edged mask recedes toward the exit point,
 *                       draining the fill out from under the outline
 *
 * The two are never cross-faded. The fill is always drawn at full opacity
 * inside the mask, and the stroke at full opacity once in, so there is no
 * intermediate state with translucent fill under a translucent stroke — the
 * final alpha is max(fill, stroke), not a blend of two half-transparent
 * layers.
 */
export async function loadHeadMesh(url: string, height: number): Promise<THREE.Mesh> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  const aspect = tex.image.width / tex.image.height;
  const geo = new THREE.PlaneGeometry(height * aspect, height);

  // farthest reach of the drain mask: the corner furthest from the exit
  // point, so at drain = 0 the whole silhouette is still filled
  const o = HOLD.fillDrainOrigin;
  let maxDist = 0;
  for (const [cx, cy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    maxDist = Math.max(maxDist, Math.hypot((cx - o.x) * aspect, cy - o.y));
  }

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: tex },
      uStrokeIn: { value: 0 },
      uDrain: { value: 0 },
      uStrokeWidth: { value: HOLD.headStrokeWidth },
      uStrokeOpacity: { value: HOLD.headStrokeOpacity },
      uMaskSoftness: { value: HOLD.fillMaskSoftness },
      uDrainOrigin: { value: new THREE.Vector2(o.x, o.y) },
      uAspect: { value: aspect },
      uMaxDist: { value: maxDist },
      uHeadColor: { value: new THREE.Color(HOLD.colors.head) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uStrokeIn, uDrain, uStrokeWidth, uStrokeOpacity;
      uniform float uMaskSoftness, uAspect, uMaxDist;
      uniform vec2 uDrainOrigin;
      uniform vec3 uHeadColor;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec4 t = texture2D(uMap, vUv);
        float a = t.a;
        vec2 uvPerPx = fwidth(vUv);

        // FILL — full opacity, revealed by a mask that recedes toward the
        // exit point. Only the masked AREA changes, never the fill's opacity.
        float soft = max(uMaskSoftness * uvPerPx.y, 1e-5);
        float radius = mix(uMaxDist + soft, -soft, uDrain);
        float dist = length((vUv - uDrainOrigin) * vec2(uAspect, 1.0));
        float fillA = a * (1.0 - smoothstep(radius - soft, radius + soft, dist));

        // same colour, so the stronger of the two wins — no translucent
        // stacking at any point in the transition
        // uOpacity fades the whole head out (mobile, where it is removed
        // from the composition rather than emptied to an outline)
        // the outline is a separate vector object now, so the plane only
        // ever draws the fill
        float alpha = fillA * uOpacity;
        if (alpha < 0.004) discard;
        // The silhouette is flat cream, so colour comes from a uniform, NOT
        // from t.rgb: outside the shape those texels are transparent black,
        // which would paint the outer half of the stroke band black.
        gl_FragColor = vec4(uHeadColor, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

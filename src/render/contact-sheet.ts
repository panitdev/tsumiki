import { mat4, vec3 } from "gl-matrix";
import { PNG } from "pngjs";
import type { Resources } from "deepslate/render";
import { getAssets } from "./assets";
import { MinecraftRenderer, makeResources, makeStructure, views, type RenderAssetData, type RenderBlock, type RenderRegion, type View } from "./shared";

const PANEL = 480;
const GUTTER = 12;
const LABEL = 25;
const DIMENSIONS = PANEL + LABEL;
const BACKGROUND = 0x19212bff;
const BORDER = 0x364555ff;
const SHEET = 0x10161fff;
const INK = 0xe3e9efff;

const CAMERAS: Record<View, [number, number, number]> = {
  iso_ne: [1, 1, -1], iso_nw: [-1, 1, -1], iso_se: [1, 1, 1], iso_sw: [-1, 1, 1],
  top: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0],
};

interface LookOptions extends RenderRegion {
  views?: readonly View[];
}

const serverResources = new WeakMap<RenderAssetData, Resources>();

export async function renderContactSheet(blocks: Iterable<RenderBlock>, options: LookOptions = {}): Promise<Buffer> {
  const requested = options.views ?? ["iso_se"];
  if (requested.length < 1 || requested.length > 4 || requested.some(view => !views.includes(view))) {
    throw new Error("Choose one to four supported camera views.");
  }

  const scene = makeStructure(blocks, options);
  const columns = Math.min(2, requested.length);
  const rows = Math.ceil(requested.length / columns);
  const output = new PNG({ width: columns * (PANEL + GUTTER) + GUTTER, height: rows * (DIMENSIONS + GUTTER) + GUTTER });
  output.data.fill(rgba(SHEET));

  requested.forEach((view, index) => {
    const [x, y] = panelPosition(index, columns);
    fillRect(output, x - 1, y - 1, PANEL + 2, DIMENSIONS + 2, BORDER);
    fillRect(output, x, y, PANEL, DIMENSIONS, BACKGROUND);
    drawLabel(output, view.replace("_", " ").toUpperCase(), x + 9, y + PANEL + 8);
  });
  if (scene.visibleBlockCount === 0) return PNG.sync.write(output);

  const assets = await getAssets();
  let resources = serverResources.get(assets.data);
  if (!resources) {
    resources = makeResources(assets.data, {
      data: new Uint8ClampedArray(assets.atlas.data),
      width: assets.atlas.width,
      height: assets.atlas.height,
      colorSpace: "srgb",
    });
    serverResources.set(assets.data, resources);
  }
  const { default: createContext } = await import("gl").catch((cause: unknown) => {
    throw new Error("Could not load headless WebGL. Install the native gl module for this Node.js version.", { cause });
  });
  const gl = createContext(PANEL, PANEL, { alpha: false, depth: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("Could not initialize headless WebGL. On Linux, run Tsumiki with Mesa and Xvfb.");

  try {
    const renderer = new MinecraftRenderer(gl, scene.structure, resources);
    const pixels = Buffer.alloc(PANEL * PANEL * 4);
    const color = rgba(BACKGROUND);
    gl.clearColor(color[0] / 255, color[1] / 255, color[2] / 255, 1);
    gl.viewport(0, 0, PANEL, PANEL);
    requested.forEach((view, index) => {
      const camera = cameraMatrices(view, scene.size);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.setProjection(camera.projection);
      renderer.drawStructure(camera.view);
      gl.readPixels(0, 0, PANEL, PANEL, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const [x, y] = panelPosition(index, columns);
      for (let row = 0; row < PANEL; row++) {
        const start = (PANEL - 1 - row) * PANEL * 4;
        pixels.copy(output.data, ((y + row) * output.width + x) * 4, start, start + PANEL * 4);
      }
    });
    renderer.dispose();
  } finally {
    gl.getExtension("STACKGL_destroy_context")?.destroy();
  }

  return PNG.sync.write(output);
}

function cameraMatrices(camera: View, [width, height, depth]: readonly [number, number, number]) {
  const center = vec3.fromValues(width / 2, height / 2, depth / 2);
  const radius = Math.hypot(width, height, depth) / 2;
  const direction = vec3.normalize(vec3.create(), CAMERAS[camera]);
  const distance = radius * 2 + 2;
  const eye = vec3.scaleAndAdd(vec3.create(), center, direction, distance);
  const view = mat4.lookAt(mat4.create(), eye, center, camera === "top" ? [0, 0, -1] : [0, 1, 0]);
  const corner = vec3.create();
  let extent = 0;
  for (const x of [0, width]) {
    for (const y of [0, height]) {
      for (const z of [0, depth]) {
        vec3.transformMat4(corner, [x, y, z], view);
        extent = Math.max(extent, Math.abs(corner[0]), Math.abs(corner[1]));
      }
    }
  }
  const frame = extent * 1.12 + 0.35;
  const projection = mat4.ortho(mat4.create(), -frame, frame, -frame, frame, 0.1, distance + radius + 2);
  return { view, projection };
}

function panelPosition(index: number, columns: number): [number, number] {
  return [GUTTER + (index % columns) * (PANEL + GUTTER), GUTTER + Math.floor(index / columns) * (DIMENSIONS + GUTTER)];
}

function rgba(color: number) {
  return Buffer.from([color >>> 24, (color >>> 16) & 255, (color >>> 8) & 255, color & 255]);
}

function fillRect(image: PNG, x: number, y: number, width: number, height: number, color: number) {
  const pixel = rgba(color);
  for (let row = y; row < y + height; row++) {
    const start = (row * image.width + x) * 4;
    image.data.fill(pixel, start, start + width * 4);
  }
}

const LETTERS: Record<string, readonly number[]> = {
  A: [2, 5, 7, 5, 5], E: [7, 4, 6, 4, 7], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7],
  N: [5, 7, 7, 7, 5], O: [7, 5, 5, 5, 7], P: [6, 5, 6, 4, 4], R: [6, 5, 6, 5, 5],
  S: [7, 4, 7, 1, 7], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], W: [5, 5, 7, 7, 5],
};

function drawLabel(image: PNG, label: string, x: number, y: number) {
  for (const letter of label) {
    LETTERS[letter]?.forEach((bits, row) => {
      for (let column = 0; column < 3; column++) {
        if (bits & (4 >> column)) fillRect(image, x + column * 2, y + row * 2, 2, 2, INK);
      }
    });
    x += 8;
  }
}

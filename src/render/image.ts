import { mat4, vec3 } from "gl-matrix";
import { PNG } from "pngjs";
import type { Resources } from "deepslate/render";
import type { Box, Position } from "../engine/geometry";
import type { SceneData } from "../engine/scene";
import { explainEmpty, select } from "../engine/selector";
import { hiddenBy, visibleScene, type Hidden } from "../engine/visibility";
import { getAssets } from "./assets";
import { MinecraftRenderer, makeResources, makeStructure, type RenderAssetData } from "./shared";

export const IMAGE_WIDTH = 960;
export const IMAGE_HEIGHT = 720;
const FIELD_OF_VIEW = Math.PI / 3;
const BACKGROUND = [0x19, 0x21, 0x2b, 0xff] as const;

export interface Camera {
  from: Position;
  at: Position;
}

export interface RenderOptions {
  camera: Camera;
  /** A selector for groups and instances to leave out. */
  hide?: string;
  /** Show only what lies inside this inclusive cell box. */
  section?: Box;
}

/** What a render shows. A selector that matches nothing is an error. */
export function renderContents(build: SceneData, { hide, section }: Omit<RenderOptions, "camera">) {
  let hidden: Hidden | undefined;
  if (hide !== undefined) {
    const selection = select(build, hide);
    if (!selection.groups.length && !selection.instances.length) throw explainEmpty(build, hide);
    hidden = hiddenBy(build, selection);
  }
  return visibleScene(build, hidden, section);
}

/** World coordinates are relative to `origin`. Looking straight up or down keeps north at the top. */
export function cameraMatrices({ from, at }: Camera, origin: Position, bounds: Box) {
  const eye = vec3.fromValues(from[0] - origin[0], from[1] - origin[1], from[2] - origin[2]);
  const target = vec3.fromValues(at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]);
  const x = at[0] - from[0], y = at[1] - from[1], z = at[2] - from[2];
  const vertical = Math.hypot(x, z) <= Math.abs(y) * 1e-3;
  const up: [number, number, number] = vertical ? [0, 0, y < 0 ? -1 : 1] : [0, 1, 0];
  const view = mat4.lookAt(mat4.create(), eye, target, up);

  // Fit the depth range to what is drawn, for the sake of depth precision.
  let nearestSquared = 0;
  let farthestSquared = 0;
  for (let axis = 0; axis < 3; axis++) {
    const low = bounds[axis] - origin[axis];
    const high = bounds[axis + 3] - origin[axis] + 1;
    nearestSquared += Math.max(low - eye[axis], 0, eye[axis] - high) ** 2;
    farthestSquared += Math.max(Math.abs(eye[axis] - low), Math.abs(eye[axis] - high)) ** 2;
  }
  const near = Math.max(0.05, Math.sqrt(nearestSquared) * 0.5);
  const far = Math.max(near + 1, Math.sqrt(farthestSquared) + 2);
  const projection = mat4.perspective(mat4.create(), FIELD_OF_VIEW, IMAGE_WIDTH / IMAGE_HEIGHT, near, far);
  return { view, projection };
}

const serverResources = new WeakMap<RenderAssetData, Resources>();

export async function renderImage(build: SceneData, options: RenderOptions) {
  const { blocks, displays, bounds } = renderContents(build, options);
  const output = new PNG({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
  output.data.fill(Buffer.from(BACKGROUND));
  const counts = { blocks: blocks.length, displays: displays.length };
  if (!bounds) return { png: PNG.sync.write(output), ...counts };

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
  const gl = createContext(IMAGE_WIDTH, IMAGE_HEIGHT, { alpha: false, depth: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("Could not initialize headless WebGL. On Linux, run Tsumiki with Mesa and Xvfb.");

  try {
    const { structure, origin } = makeStructure(blocks, bounds);
    const renderer = new MinecraftRenderer(gl, structure, resources);
    renderer.setDisplays(displays, origin);
    const camera = cameraMatrices(options.camera, origin, bounds);
    gl.clearColor(BACKGROUND[0] / 255, BACKGROUND[1] / 255, BACKGROUND[2] / 255, 1);
    gl.viewport(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    renderer.setProjection(camera.projection);
    renderer.drawStructure(camera.view);
    renderer.drawDisplays(camera.view);
    const pixels = Buffer.alloc(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
    gl.readPixels(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const stride = IMAGE_WIDTH * 4;
    for (let row = 0; row < IMAGE_HEIGHT; row++) {
      pixels.copy(output.data, row * stride, (IMAGE_HEIGHT - 1 - row) * stride, (IMAGE_HEIGHT - row) * stride);
    }
    renderer.dispose();
  } finally {
    gl.getExtension("STACKGL_destroy_context")?.destroy();
  }
  return { png: PNG.sync.write(output), ...counts };
}

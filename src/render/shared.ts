import {
  BlockDefinition,
  BlockModel,
  BlockState,
  ChunkBuilder,
  Identifier,
  Renderer,
  SpecialRenderers,
  TextureAtlas,
  type BlockFlags,
  type BlockModelElement,
  type BlockPos,
  type PlacedBlock,
  type Resources,
  type StructureProvider,
  type UV,
} from "deepslate/render";
import { mat4 } from "gl-matrix";

export const views = ["iso_ne", "iso_nw", "iso_se", "iso_sw", "top", "north", "south", "east", "west"] as const;
export type View = (typeof views)[number];

export interface RenderBlock {
  x: number;
  y: number;
  z: number;
  state: string;
}

export interface RenderRegion {
  box?: readonly [number, number, number, number, number, number];
  cutY?: number;
}

export interface RenderAssetData {
  version: string;
  blockstates: Record<string, unknown>;
  models: Record<string, unknown>;
  textures: Record<string, UV>;
  flags: Record<string, BlockFlags>;
  defaults: Record<string, Record<string, string>>;
}

const AIR = new Set(["air", "cave_air", "void_air", "minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
const MISSING_MODEL = "tsumiki:block/missing";
const MODEL_NAMESPACE = "tsumiki_model";
const FACES = ["north", "south", "east", "west", "up", "down"];

export function makeStructure(blocks: Iterable<RenderBlock>, { box, cutY }: RenderRegion = {}) {
  const min: BlockPos = box
    ? [Math.min(box[0], box[3]), Math.min(box[1], box[4]), Math.min(box[2], box[5])]
    : [Infinity, Infinity, Infinity];
  const max: BlockPos = box
    ? [Math.max(box[0], box[3]), Math.max(box[1], box[4]), Math.max(box[2], box[5])]
    : [-Infinity, -Infinity, -Infinity];
  const visible: RenderBlock[] = [];

  for (const block of blocks) {
    const { x, y, z, state } = block;
    if ((cutY !== undefined && y > cutY) || AIR.has(state)) continue;
    if (box) {
      if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) continue;
    } else {
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
      max[2] = Math.max(max[2], z);
    }
    visible.push(block);
  }

  const origin: BlockPos = Number.isFinite(min[0]) ? min : [0, 0, 0];
  const size: BlockPos = Number.isFinite(max[0])
    ? [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1]
    : [0, 0, 0];
  const states = new Map<string, BlockState>();
  const placed: PlacedBlock[] = [];
  const byPosition = new Map<number | string, PlacedBlock>();
  const [width, height, depth] = size;
  const key = width * height * depth <= Number.MAX_SAFE_INTEGER
    ? ([x, y, z]: BlockPos) => (x * height + y) * depth + z
    : ([x, y, z]: BlockPos) => `${x},${y},${z}`;

  for (const { x, y, z, state } of visible) {
    let parsed = states.get(state);
    if (parsed === undefined) {
      parsed = BlockState.parse(state);
      states.set(state, parsed);
    }
    const pos: BlockPos = [x - origin[0], y - origin[1], z - origin[2]];
    const block = { pos, state: parsed };
    byPosition.set(key(pos), block);
    placed.push(block);
  }

  const structure: StructureProvider = {
    getSize: () => size,
    getBlocks: () => placed,
    getBlock(pos) {
      const [x, y, z] = pos;
      if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) return null;
      return byPosition.get(key(pos)) ?? null;
    },
  };
  return { structure, origin, size, visibleBlockCount: placed.length };
}

interface MinecraftResources extends Resources {
  modelOnly?: ReadonlySet<string>;
}

export function makeResources(data: RenderAssetData, atlas: ImageData | HTMLImageElement): MinecraftResources {
  let image: ImageData;
  if ("data" in atlas) {
    image = atlas;
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = atlas.naturalWidth;
    canvas.height = atlas.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read the Minecraft texture atlas.");
    context.drawImage(atlas, 0, 0);
    image = context.getImageData(0, 0, canvas.width, canvas.height);
  }

  const textureAtlas = new TextureAtlas(image, data.textures);
  const definitions = new Map(Object.entries(data.blockstates).map(([id, json]) => [id, BlockDefinition.fromJson(json)]));
  const models = new Map<string, BlockModel>(Object.entries(data.models).map(([id, json]) => [id, clientModel(json)]));
  const fallback = BlockDefinition.fromJson({ variants: { "": { model: MISSING_MODEL } } });
  models.set(MISSING_MODEL, BlockModel.fromJson({
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: Object.fromEntries(FACES.map(face => [face, { texture: "#missing", cullface: face }])),
    }],
  }));
  const provider = { getBlockModel: (id: Identifier) => models.get(id.toString()) ?? null };
  for (const model of models.values()) model.flatten(provider);
  const modelOnly = new Set([...definitions.keys()].filter(id => usesStaticModel(id, data.textures)));
  supplementSpecialModels(definitions);
  const blockId = (id: Identifier) => id.namespace === MODEL_NAMESPACE ? `minecraft:${id.path}` : id.toString();

  return {
    ...provider,
    modelOnly,
    getBlockDefinition: id => definitions.get(blockId(id)) ?? fallback,
    getBlockFlags: id => data.flags[blockId(id)] ?? null,
    getBlockProperties: () => null,
    getDefaultBlockProperties: id => data.defaults[blockId(id)] ?? null,
    getTextureAtlas: () => textureAtlas.getTextureAtlas(),
    getTextureUV: id => textureAtlas.getTextureUV(id),
    getPixelSize: () => textureAtlas.getPixelSize(),
  };
}

const WALL_HEAD_PLACEMENT: Record<string, readonly [number, number, string]> = {
  south: [0, -0.25, "0"], east: [-0.25, 0, "4"], north: [0, 0.25, "8"], west: [0.25, 0, "12"],
};

function supplementSpecialModels(definitions: Map<string, BlockDefinition>) {
  for (const [id, definition] of definitions) {
    if (/^minecraft:.+_wall_(head|skull)$/.test(id)) {
      const head = Identifier.parse(id.replace("_wall_", "_"));
      definitions.set(id, new SupplementalDefinition(definition, (properties, atlas, cull) => {
        const [x, z, rotation] = WALL_HEAD_PLACEMENT[properties.facing] ?? WALL_HEAD_PLACEMENT.north;
        const transform = mat4.fromTranslation(mat4.create(), [x, 0.25, z]);
        return SpecialRenderers.getBlockMesh(new BlockState(head, { rotation }), undefined, atlas, cull).transform(transform);
      }));
    } else if (id === "minecraft:shulker_box") {
      // Reuse the colored shulker geometry with the undecorated skin from the client jar.
      const neutralSkin = Identifier.create("entity/shulker/shulker");
      definitions.set(id, new SupplementalDefinition(definition, (properties, atlas, cull) => {
        const texture = {
          getTextureAtlas: () => atlas.getTextureAtlas(),
          getTextureUV: () => atlas.getTextureUV(neutralSkin),
        };
        return SpecialRenderers.getBlockMesh(new BlockState("purple_shulker_box", properties), undefined, texture, cull);
      }));
    }
  }
}

type DefinitionArgs = Parameters<BlockDefinition["getMesh"]>;
type ExtraMesh = (props: DefinitionArgs[1], atlas: DefinitionArgs[2], cull: DefinitionArgs[4]) => ReturnType<BlockDefinition["getMesh"]>;

class SupplementalDefinition extends BlockDefinition {
  constructor(private readonly base: BlockDefinition, private readonly extra: ExtraMesh) {
    super(undefined, undefined);
  }

  override getMesh(...args: DefinitionArgs) {
    const mesh = this.base.getMesh(...args);
    return mesh.isEmpty() ? this.extra(args[1], args[2], args[4]) : mesh;
  }
}

function usesStaticModel(id: string, textures: RenderAssetData["textures"]) {
  const sign = /^minecraft:(.+?)(?:_wall)?(_hanging)?_sign$/.exec(id);
  if (sign) return Object.hasOwn(textures, `minecraft:block/${sign[1]}${sign[2] ?? ""}_sign`);
  const bed = /^minecraft:(.+)_bed$/.exec(id);
  return bed ? Object.hasOwn(textures, `minecraft:block/${bed[1]}_bed_foot_up`) : false;
}

function renderModels(structure: StructureProvider, modelOnly?: ReadonlySet<string>): StructureProvider {
  if (!modelOnly?.size) return structure;
  // New clients provide sign and bed geometry in block models. An internal name keeps
  // Deepslate from adding a second legacy model that refers to removed entity textures.
  const original = structure.getBlocks();
  const replacements = new Map<PlacedBlock, PlacedBlock>();
  const states = new Map<BlockState, BlockState>();
  for (const block of original) {
    const state = block.state;
    let modelState = states.get(state);
    if (!modelState) {
      const id = state.getName();
      modelState = modelOnly.has(id.toString())
        ? new BlockState(new Identifier(MODEL_NAMESPACE, id.path), { ...state.getProperties() })
        : state;
      states.set(state, modelState);
    }
    if (modelState !== state) replacements.set(block, { ...block, state: modelState });
  }
  if (!replacements.size) return structure;

  return {
    getSize: () => structure.getSize(),
    getBlocks: () => original.map(block => replacements.get(block) ?? block),
    getBlock(pos) {
      const block = structure.getBlock(pos);
      return block ? replacements.get(block) ?? block : null;
    },
  };
}

type ModelTextures = ConstructorParameters<typeof BlockModel>[1];
type ModelJson = { parent?: string; textures?: ModelTextures; elements?: BlockModelElement[] };
type EulerRotation = { origin: [number, number, number]; x: number; y: number; z: number };

function clientModel(json: unknown): BlockModel {
  const { parent, textures, elements } = json as ModelJson;
  return new ClientBlockModel(parent ? Identifier.parse(parent) : undefined, textures && { ...textures }, elements);
}

class ClientBlockModel extends BlockModel {
  override getElementMesh(...[element, atlas, cull, tint]: Parameters<BlockModel["getElementMesh"]>) {
    const rotation = element.rotation as BlockModelElement["rotation"] | EulerRotation;
    if (!rotation || !("x" in rotation)) return super.getElementMesh(element, atlas, cull, tint);

    // 26.3 also permits X/Y/Z angles in cuboid rotations. Deepslate handles only the single-axis form.
    const { origin, x, y, z } = rotation;
    const radians = Math.PI / 180;
    const transform = mat4.create();
    mat4.translate(transform, transform, origin);
    mat4.rotateZ(transform, transform, z * radians);
    mat4.rotateY(transform, transform, y * radians);
    mat4.rotateX(transform, transform, x * radians);
    mat4.translate(transform, transform, [-origin[0], -origin[1], -origin[2]]);
    return super.getElementMesh({ ...element, rotation: undefined }, atlas, cull, tint).transform(transform);
  }
}

export class MinecraftRenderer extends Renderer {
  protected chunkBuilder: ChunkBuilder;
  private readonly atlasTexture: WebGLTexture;

  constructor(gl: WebGLRenderingContext, structure: StructureProvider, private readonly resources: MinecraftResources) {
    super(gl);
    this.atlasTexture = this.createAtlasTexture(resources.getTextureAtlas());
    this.chunkBuilder = new ChunkBuilder(gl, renderModels(structure, resources.modelOnly), resources, 8);
  }

  protected getPerspective(): mat4 {
    const { drawingBufferWidth, drawingBufferHeight } = this.gl;
    return mat4.perspective(mat4.create(), Math.PI / 3, drawingBufferWidth / Math.max(1, drawingBufferHeight), 0.1, 500);
  }

  // The typed-array upload works in a browser and in a headless WebGL context.
  protected createAtlasTexture(image: ImageData): WebGLTexture {
    const gl = this.gl;
    if (Math.max(image.width, image.height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      throw new Error("The Minecraft texture atlas is larger than this WebGL context supports.");
    }
    const texture = gl.createTexture();
    if (!texture) throw new Error("Could not allocate the Minecraft texture atlas.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const pixels = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }

  setProjection(projection: mat4) {
    this.projMatrix = projection;
  }

  setStructure(structure: StructureProvider) {
    this.releaseMeshes();
    this.chunkBuilder = new ChunkBuilder(this.gl, renderModels(structure, this.resources.modelOnly), this.resources, 8);
  }

  protected bindAtlas() {
    this.setTexture(this.atlasTexture, this.resources.getPixelSize?.());
  }

  drawStructure(view: mat4) {
    this.setShader(this.shaderProgram);
    this.bindAtlas();
    this.prepareDraw(view);
    for (const mesh of this.chunkBuilder.getMeshes()) {
      this.drawMesh(mesh, { pos: true, color: true, texture: true, normal: true });
    }
  }

  dispose() {
    this.releaseMeshes();
    this.gl.deleteTexture(this.atlasTexture);
    for (const shader of this.gl.getAttachedShaders(this.shaderProgram) ?? []) this.gl.deleteShader(shader);
    this.gl.deleteProgram(this.shaderProgram);
  }

  private releaseMeshes() {
    for (const mesh of this.chunkBuilder.getMeshes()) {
      for (const buffer of [mesh.posBuffer, mesh.colorBuffer, mesh.textureBuffer, mesh.textureLimitBuffer,
        mesh.normalBuffer, mesh.blockPosBuffer, mesh.indexBuffer, mesh.linePosBuffer, mesh.lineColorBuffer]) {
        if (buffer) this.gl.deleteBuffer(buffer);
      }
    }
  }
}

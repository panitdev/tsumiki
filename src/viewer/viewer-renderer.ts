import { Mesh, ShaderProgram, type Resources } from "deepslate/render";
import type { BlockPos, StructureProvider } from "deepslate/core";
import { mat4 } from "gl-matrix";
import type { Box } from "../engine/geometry";
import type { VisibleDisplay } from "../engine/visibility";
import { MinecraftRenderer } from "../render/shared";

/** Alpha written by the picking pass, telling grid blocks and block displays apart. */
const PICK_BLOCK = 1;
const PICK_DISPLAY = 0.5;

export type Picked = { kind: "block"; position: BlockPos } | { kind: "display"; instance: number };

const lineVertex = `
  attribute vec4 vertPos;
  attribute vec3 vertColor;
  uniform mat4 mProj;
  uniform mat4 mView;
  varying mediump vec3 color;
  void main() {
    gl_Position = mProj * mView * vertPos;
    color = vertColor;
  }
`;

const lineFragment = `
  precision mediump float;
  varying mediump vec3 color;
  void main() {
    gl_FragColor = vec4(color, 1.0);
  }
`;

const pickVertex = `
  attribute vec4 vertPos;
  attribute vec2 texCoord;
  attribute vec4 texLimit;
  attribute vec3 blockPos;
  uniform mat4 mProj;
  uniform mat4 mView;
  uniform float divisor;
  varying highp vec2 uv;
  varying highp vec4 limit;
  varying highp vec3 encoded;
  void main() {
    gl_Position = mProj * mView * vertPos;
    uv = texCoord;
    limit = texLimit;
    encoded = mod(floor(blockPos / divisor), 256.0) / 255.0;
  }
`;

const pickFragment = `
  precision highp float;
  varying highp vec2 uv;
  varying highp vec4 limit;
  varying highp vec3 encoded;
  uniform sampler2D sampler;
  uniform float pixelSize;
  uniform float kind;
  void main() {
    vec2 inset = vec2(0.5 * pixelSize);
    if (texture2D(sampler, clamp(uv, limit.xy + inset, limit.zw - inset)).a < 0.01) discard;
    gl_FragColor = vec4(encoded, kind);
  }
`;

function makeProgram(gl: WebGLRenderingContext, vertex: string, fragment: string) {
  const program = new ShaderProgram(gl, vertex, fragment).getProgram();
  for (const shader of gl.getAttachedShaders(program) ?? []) gl.deleteShader(shader);
  return program;
}

export class ViewerRenderer extends MinecraftRenderer {
  private readonly grid = new Mesh();
  private readonly gridProgram: WebGLProgram;
  private readonly pickProgram: WebGLProgram;
  private readonly pickDivisor: WebGLUniformLocation | null;
  private readonly pickKind: WebGLUniformLocation | null;
  private readonly highlight = new Mesh();
  private maxInstance = 0;
  private readonly pickFramebuffer: WebGLFramebuffer;
  private readonly pickTexture: WebGLTexture;
  private readonly pickDepth: WebGLRenderbuffer;
  private readonly attributeCount: number;
  private readonly pickMatrix = mat4.create();
  private readonly pixel = new Uint8Array(4);
  private activeProgram: WebGLProgram | null = null;
  private sceneSize: BlockPos = [1, 1, 1];

  constructor(gl: WebGLRenderingContext, structure: StructureProvider, resources: Resources) {
    super(gl, structure, resources);
    this.gridProgram = makeProgram(gl, lineVertex, lineFragment);
    this.pickProgram = makeProgram(gl, pickVertex, pickFragment);
    this.pickDivisor = gl.getUniformLocation(this.pickProgram, "divisor");
    this.pickKind = gl.getUniformLocation(this.pickProgram, "kind");
    this.attributeCount = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);

    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    const depth = gl.createRenderbuffer();
    if (!framebuffer || !texture || !depth) throw new Error("Couldn’t start the block inspector.");
    this.pickFramebuffer = framebuffer;
    this.pickTexture = texture;
    this.pickDepth = depth;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (framebufferStatus !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Couldn’t initialize block picking.");
    this.setSceneSize(structure.getSize());
  }

  override setStructure(structure: StructureProvider) {
    this.clearVertexAttributes();
    super.setStructure(structure);
    this.setSceneSize(structure.getSize());
  }

  override setDisplays(displays: readonly VisibleDisplay[], origin: BlockPos) {
    this.clearVertexAttributes();
    super.setDisplays(displays, origin);
    this.maxInstance = displays.reduce((max, display) => Math.max(max, display.instance), 0);
  }

  /** Outlines the cells of a selection. */
  setHighlight(box: Box | null, origin: BlockPos) {
    this.clearVertexAttributes();
    this.highlight.clear();
    if (box) {
      const [x1, y1, z1, x2, y2, z2] = box;
      this.highlight.addLineCube(x1 - origin[0], y1 - origin[1], z1 - origin[2],
        x2 - origin[0] + 1, y2 - origin[1] + 1, z2 - origin[2] + 1, [0.98, 0.62, 0.12]);
    }
    this.highlight.rebuild(this.gl, { pos: true, color: true });
  }

  drawHighlight(view: mat4) {
    if (this.highlight.isEmpty()) return;
    // Selections stay visible through the blocks around them.
    this.gl.disable(this.gl.DEPTH_TEST);
    this.setShader(this.gridProgram);
    this.prepareDraw(view);
    this.drawMesh(this.highlight, { pos: true, color: true });
    this.gl.enable(this.gl.DEPTH_TEST);
  }

  protected override setShader(program: WebGLProgram) {
    if (this.activeProgram !== program) {
      this.clearVertexAttributes();
      this.activeProgram = program;
    }
    super.setShader(program);
  }

  private clearVertexAttributes() {
    // Switching passes also drops bindings to any buffers from a replaced mesh.
    for (let index = 0; index < this.attributeCount; index++) this.gl.disableVertexAttribArray(index);
  }

  private setSceneSize(size: BlockPos) {
    this.sceneSize = size;
    const maxSide = Math.max(1, ...size);
    this.grid.clear();
    const step = 2 ** Math.ceil(Math.log2(Math.max(maxSide / 24, 1)));
    const [width, , depth] = size;
    const padding = Math.max(3, 4 * step);
    const min = -padding;
    const maxX = Math.max(6, Math.ceil(width / step) * step + padding);
    const maxZ = Math.max(6, Math.ceil(depth / step) * step + padding);
    for (let x = min; x <= maxX; x += step) {
      this.grid.addLine(x, -0.025, min, x, -0.025, maxZ, [0.79, 0.80, 0.75]);
    }
    for (let z = min; z <= maxZ; z += step) {
      this.grid.addLine(min, -0.025, z, maxX, -0.025, z, [0.79, 0.80, 0.75]);
    }
    this.grid.rebuild(this.gl, { pos: true, color: true });
  }

  drawGrid(view: mat4) {
    this.setShader(this.gridProgram);
    this.prepareDraw(view);
    this.drawMesh(this.grid, { pos: true, color: true });
  }

  pick(x: number, y: number, width: number, height: number, view: mat4, projection: mat4): Picked | null {
    const gl = this.gl;
    const result: BlockPos = [0, 0, 0];
    mat4.set(this.pickMatrix, width, 0, 0, 0, 0, height, 0, 0, 0, 0, 1, 0,
      width - 2 * x - 1, 2 * y - height + 1, 0, 1);
    mat4.multiply(this.pickMatrix, this.pickMatrix, projection);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    gl.clearColor(0, 0, 0, 0);
    this.setProjection(this.pickMatrix);
    this.setShader(this.pickProgram);
    this.bindAtlas();
    this.prepareDraw(view);
    const meshes = this.chunkBuilder.getMeshes();
    const largest = Math.max(1, ...this.sceneSize, this.maxInstance + 1);
    const passes = Math.max(1, Math.ceil(Math.log2(largest) / 8));
    let alpha = 0;
    try {
      // Each pass stores one byte of each local coordinate in RGB.
      for (let pass = 0, divisor = 1; pass < passes; pass++, divisor *= 256) {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniform1f(this.pickDivisor, divisor);
        gl.uniform1f(this.pickKind, PICK_BLOCK);
        for (const mesh of meshes) this.drawMesh(mesh, { pos: true, texture: true, blockPos: true });
        gl.uniform1f(this.pickKind, PICK_DISPLAY);
        for (const mesh of this.displayMeshes) this.drawMesh(mesh, { pos: true, texture: true, blockPos: true });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
        alpha = this.pixel[3];
        if (alpha === 0) return null;
        result[0] += this.pixel[0] * divisor;
        result[1] += this.pixel[1] * divisor;
        result[2] += this.pixel[2] * divisor;
      }
      return alpha > 192 ? { kind: "block", position: result } : { kind: "display", instance: result[0] };
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.enable(gl.BLEND);
      gl.enable(gl.DITHER);
      this.setProjection(projection);
    }
  }

  override dispose() {
    const gl = this.gl;
    this.clearVertexAttributes();
    gl.useProgram(null);
    for (const lines of [this.grid, this.highlight]) {
      if (lines.linePosBuffer) gl.deleteBuffer(lines.linePosBuffer);
      if (lines.lineColorBuffer) gl.deleteBuffer(lines.lineColorBuffer);
    }
    gl.deleteProgram(this.gridProgram);
    gl.deleteProgram(this.pickProgram);
    gl.deleteTexture(this.pickTexture);
    gl.deleteRenderbuffer(this.pickDepth);
    gl.deleteFramebuffer(this.pickFramebuffer);
    super.dispose();
  }
}

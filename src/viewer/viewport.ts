import { mat4, vec3 } from "gl-matrix";
import type { Resources } from "deepslate/render";
import type { Box } from "../engine/geometry";
import type { VisibleBlock, VisibleDisplay } from "../engine/visibility";
import { makeStructure } from "../render/shared";
import { ViewerRenderer } from "./viewer-renderer";

const fieldOfView = Math.PI / 4;
const up = vec3.fromValues(0, 1, 0);

interface PointerPosition { x: number; y: number }
export type Inspected =
  | { kind: "block"; state: string; x: number; y: number; z: number }
  | { kind: "display"; instance: number };

export interface ViewportScene {
  blocks: readonly VisibleBlock[];
  displays: readonly VisibleDisplay[];
  /** Bounds of the whole build, so that hiding parts does not move the camera. */
  frame: Box | null;
  highlight: Box | null;
}

export class Viewport {
  private readonly gl: WebGLRenderingContext;
  private readonly listeners = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly target = vec3.create();
  private readonly eye = vec3.create();
  private readonly right = vec3.create();
  private readonly cameraUp = vec3.create();
  private readonly view = mat4.create();
  private readonly projection = mat4.create();
  private readonly pointers = new Map<number, PointerPosition>();
  private model: ReturnType<typeof makeStructure> | null = null;
  private renderer: ViewerRenderer | null = null;
  private pointer: PointerPosition | null = null;
  private frameId: number | null = null;
  private size = 1;
  private distance = 6;
  private azimuth = Math.PI / 4;
  private elevation = Math.PI / 6;
  private glDirty = true;
  private pickDirty = false;
  private cameraIsFramed = true;
  private failed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly resources: Resources,
    private readonly onPick: (picked: Inspected | null) => void,
    private readonly onError: (error: unknown) => void,
  ) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl) throw new Error("WebGL is unavailable in this browser.");
    this.gl = gl;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.cameraIsFramed) this.frame();
      this.invalidate();
    });
    this.resizeObserver.observe(canvas);

    const options = { signal: this.listeners.signal };
    canvas.addEventListener("pointerdown", this.pointerDown, options);
    canvas.addEventListener("pointermove", this.pointerMove, options);
    canvas.addEventListener("pointerup", this.pointerEnd, options);
    canvas.addEventListener("pointercancel", this.pointerEnd, options);
    canvas.addEventListener("lostpointercapture", this.pointerEnd, options);
    canvas.addEventListener("pointerleave", this.pointerLeave, options);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), options);
    canvas.addEventListener("keydown", this.keyDown, options);
    canvas.addEventListener("wheel", this.wheel, { ...options, passive: false });
    this.invalidate();
  }

  setScene({ blocks, displays, frame, highlight }: ViewportScene) {
    const previous = this.model;
    this.model = frame ? makeStructure(blocks, frame) : null;
    const { gl, model } = this;
    if (model) {
      if (this.renderer) this.renderer.setStructure(model.structure);
      else this.renderer = new ViewerRenderer(gl, model.structure, this.resources);
      this.renderer.setDisplays(displays, model.origin);
      this.renderer.setHighlight(highlight, model.origin);
      this.size = Math.max(1, Math.hypot(...model.size));
      if (previous && !this.cameraIsFramed) {
        vec3.add(this.target, this.target, previous.origin);
        vec3.sub(this.target, this.target, model.origin);
      } else {
        this.frame();
      }
    } else {
      this.renderer?.dispose();
      this.renderer = null;
      this.cameraIsFramed = true;
    }
    this.onPick(null);
    this.invalidate();
  }

  frame() {
    if (!this.model) return;
    const [width, height, depth] = this.model.size;
    vec3.set(this.target, width / 2, height / 2, depth / 2);
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const vertical = fieldOfView / 2;
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.1, aspect));
    this.distance = Math.max(3.5, this.size * 0.55 / Math.sin(Math.min(vertical, horizontal)));
    this.azimuth = Math.PI / 4;
    this.elevation = Math.PI / 6;
    this.cameraIsFramed = true;
    this.invalidate();
  }

  zoom(factor: number) {
    this.distance = Math.min(this.size * 60 + 32, Math.max(0.125, this.distance * factor));
    this.cameraIsFramed = false;
    this.invalidate();
  }

  dispose() {
    this.listeners.abort();
    this.resizeObserver.disconnect();
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.renderer?.dispose();
    delete this.canvas.dataset.dragging;
  }

  private orbit(x: number, y: number) {
    this.azimuth = (this.azimuth - x * 0.008) % (Math.PI * 2);
    this.elevation = Math.max(-1.54, Math.min(1.54, this.elevation + y * 0.008));
    this.cameraIsFramed = false;
    this.invalidate();
  }

  private pan(x: number, y: number) {
    this.updateView();
    vec3.set(this.right, this.view[0], this.view[4], this.view[8]);
    vec3.set(this.cameraUp, this.view[1], this.view[5], this.view[9]);
    const scale = 2 * this.distance * Math.tan(fieldOfView / 2) / Math.max(this.canvas.clientHeight, 1);
    vec3.scaleAndAdd(this.target, this.target, this.right, -x * scale);
    vec3.scaleAndAdd(this.target, this.target, this.cameraUp, y * scale);
    this.cameraIsFramed = false;
    this.invalidate();
  }

  private updateView() {
    const horizontal = this.distance * Math.cos(this.elevation);
    vec3.set(this.eye,
      this.target[0] + horizontal * Math.sin(this.azimuth),
      this.target[1] + this.distance * Math.sin(this.elevation),
      this.target[2] + horizontal * Math.cos(this.azimuth));
    mat4.lookAt(this.view, this.eye, this.target, up);
  }

  private invalidate(drawScene = true) {
    this.glDirty ||= drawScene;
    this.pickDirty = true;
    if (this.frameId === null && !this.failed) this.frameId = requestAnimationFrame(this.draw);
  }

  private draw = () => {
    this.frameId = null;
    const { canvas, gl, model, renderer } = this;
    if (gl.isContextLost()) return;
    try {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (this.glDirty || canvas.width !== width || canvas.height !== height) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.updateView();
        const near = Math.max(0.01, (this.distance - this.size) * 0.25);
        const far = Math.max(30, this.distance + vec3.length(this.target) + this.size * 8);
        mat4.perspective(this.projection, fieldOfView, width / height, near, far);
        renderer?.setProjection(this.projection);
        renderer?.drawGrid(this.view);
        renderer?.drawStructure(this.view);
        renderer?.drawDisplays(this.view);
        renderer?.drawHighlight(this.view);
        this.glDirty = false;
      }

      if (this.pickDirty && renderer && model && this.pointer) {
        const { x, y } = this.pointer;
        const pixelX = Math.floor(x * width / Math.max(1, canvas.clientWidth));
        const pixelY = Math.floor(y * height / Math.max(1, canvas.clientHeight));
        const picked = pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height
          ? renderer.pick(pixelX, pixelY, width, height, this.view, this.projection)
          : null;
        if (picked?.kind === "display") {
          this.onPick(picked);
        } else {
          const block = picked ? model.structure.getBlock(picked.position) : null;
          this.onPick(block ? {
            kind: "block",
            state: block.state.toString(),
            x: block.pos[0] + model.origin[0],
            y: block.pos[1] + model.origin[1],
            z: block.pos[2] + model.origin[2],
          } : null);
        }
      }
      this.pickDirty = false;
    } catch (error) {
      this.failed = true;
      this.onError(error);
    }
  };

  private pointerDown = (event: PointerEvent) => {
    if (event.button < 0 || event.button > 2) return;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.canvas.dataset.dragging = "true";
    this.pointerLeave();
  };

  private pointerMove = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId);
    if (previous) {
      const current = { x: event.clientX, y: event.clientY };
      this.pointers.set(event.pointerId, current);
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      const other = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const previousSeparation = Math.hypot(previous.x - other.x, previous.y - other.y);
        const separation = Math.hypot(current.x - other.x, current.y - other.y);
        if (previousSeparation > 1 && separation > 1) this.zoom(previousSeparation / separation);
        this.pan(dx / 2, dy / 2);
      } else if (event.shiftKey || (event.buttons & 6) !== 0) {
        this.pan(dx, dy);
      } else {
        this.orbit(dx, dy);
      }
      return;
    }
    if (event.pointerType !== "touch") this.pointAt(event);
  };

  private pointerEnd = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId) || this.pointers.size) return;
    delete this.canvas.dataset.dragging;
    if (event.type === "pointerup") this.pointAt(event);
  };

  private pointAt(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.invalidate(false);
  }

  private pointerLeave = (event?: PointerEvent) => {
    if (event?.pointerType === "touch") return;
    this.pointer = null;
    this.onPick(null);
  };

  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1;
    const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
    this.zoom(Math.exp(delta * 0.002));
  };

  private keyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case "Home": this.frame(); break;
      case "+":
      case "=": this.zoom(0.8); break;
      case "-": this.zoom(1.25); break;
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        const x = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
        const y = event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0;
        if (event.shiftKey) this.pan(x, y);
        else this.orbit(x, y);
        break;
      }
      default: return;
    }
    event.preventDefault();
  };
}

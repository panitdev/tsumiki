import type { Box } from "../engine/geometry";
import type { SceneData } from "../engine/scene";

export interface StructureSummary {
  name: string;
  /** Bounds and counts describe the last good build. */
  bounds: Box | null;
  blockCount: number;
  displayCount: number;
  revision: number;
  version: number;
  /** Why the current build.js does not build, or null. */
  buildError: string | null;
}

export interface StructureSnapshot extends StructureSummary {
  build: SceneData;
}

export function structurePath(name: string) {
  return `/${encodeURIComponent(name)}`;
}

export function formatDimensions(bounds: Box | null) {
  if (!bounds) return "—";
  return [bounds[3] - bounds[0] + 1, bounds[4] - bounds[1] + 1, bounds[5] - bounds[2] + 1].join(" × ");
}

export const numberFormat = new Intl.NumberFormat("en");

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = typeof body?.error === "string" ? body.error : `Request failed (${response.status}).`;
    throw new Error(error);
  }
  return response.json();
}

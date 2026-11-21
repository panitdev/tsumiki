import type { RenderBlock } from "../render/shared";

export type Bounds = [number, number, number, number, number, number];

export interface StructureSummary {
  name: string;
  bounds: Bounds | null;
  blockCount: number;
  historyDepth: number;
  version: number;
}

export interface StructureSnapshot extends StructureSummary {
  blocks: RenderBlock[];
}

export function structurePath(name: string) {
  return `/${encodeURIComponent(name)}`;
}

export function formatDimensions(bounds: Bounds | null) {
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

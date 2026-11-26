import { runBuild } from "./build";
import { diffScenes, formatReport } from "./report";
import { decodeScene, emptyScene, encodeScene, type SceneData } from "./scene";

export interface SourceBuild {
  /** The new last good build, absent when the build failed. */
  data?: SceneData;
  error?: string;
  report: string;
}

/**
 * Builds source from scratch and reports the changes since the previous good build.
 * The script runs synchronously on the calling thread for up to its time limit.
 */
export async function buildSource(source: string | null, previous: SceneData | null): Promise<SourceBuild> {
  const started = performance.now();
  const result = source === null
    ? { ok: false as const, error: "/project/build.js is missing or is not a regular file.", logs: [] }
    : await runBuild(source);
  const milliseconds = performance.now() - started;
  if (!result.ok) {
    const report = formatReport(result, milliseconds);
    return { error: report.split("\n", 1)[0], report };
  }
  const diff = diffScenes(previous ? decodeScene(previous) : emptyScene(), result.scene);
  return { data: encodeScene(result.scene), report: formatReport(result, milliseconds, diff) };
}

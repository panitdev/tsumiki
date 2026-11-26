import { HttpResponse, delay, http, sse } from "msw";
import { ATLAS_BASE64 } from "./atlas-data";
import { assetManifest, failingStructures, findSnapshot, structureSummaries } from "./fixtures";
import type { StructureSnapshot } from "../viewer/data";

const pngBytes = () => Uint8Array.from(atob(ATLAS_BASE64), c => c.charCodeAt(0));

function snapshotResponse(snapshot: StructureSnapshot | null, error?: string) {
  return HttpResponse.json(snapshot ?? { error: error ?? "Structure not found." }, {
    status: snapshot ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export const handlers = [
  http.get("*/api/structures", async () =>
    HttpResponse.json(
      { structures: structureSummaries },
      { headers: { "Cache-Control": "no-store" } },
    )),

  http.get("*/api/structures/:name", async ({ params }) => {
    const name = String(params.name);
    if (failingStructures.has(name)) {
      await delay(120);
      return snapshotResponse(null, "The builder agent lost this structure.");
    }
    return snapshotResponse(findSnapshot(name));
  }),

  http.get("*/api/structures/:name/export", () => new HttpResponse("mock export", {
    headers: { "Content-Type": "application/octet-stream" },
  })),

  // Live updates: the hook reloads the snapshot when the version changes.
  sse<{ change: string }>("*/api/structures/:name/events", ({ client }) => {
    // Announce once so the story settles at "Live", then stay quiet.
    setTimeout(() => {
      client.send({
        event: "change",
        data: JSON.stringify({ version: 7 }),
      });
    }, 300);
  }),

  http.get("*/api/assets", async () => HttpResponse.json(assetManifest())),

  http.get("*/api/assets/atlas", async () => new HttpResponse(pngBytes(), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  })),
];

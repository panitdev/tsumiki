import { listStructures } from "@/src/server/store";
import { viewerAccess, viewerUnauthorized } from "@/src/server/viewer-access";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await viewerAccess()).allowed) return viewerUnauthorized();
  return Response.json({ structures: await listStructures() }, { headers: { "Cache-Control": "no-store" } });
}

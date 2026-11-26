import { lastBuild, ToolError, validateName } from "@/src/server/store";
import { viewerAccess, viewerUnauthorized } from "@/src/server/viewer-access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ structure: string }> }) {
  if (!(await viewerAccess()).allowed) return viewerUnauthorized();
  try {
    const { structure } = await params;
    const { info, build } = await lastBuild(validateName(structure));
    return Response.json({ ...info, build }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ToolError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

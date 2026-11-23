import { blockEntries, snapshot, ToolError, validateName } from "@/src/server/store";
import { viewerAccess, viewerUnauthorized } from "@/src/server/viewer-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ structure: string }> }) {
  if (!(await viewerAccess()).allowed) return viewerUnauthorized();
  try {
    const { structure } = await params;
    const undo = Number(new URL(request.url).searchParams.get("undo") ?? 0);
    if (!Number.isSafeInteger(undo) || undo < 0) throw new ToolError("Invalid undo step.", "Use a non-negative integer.");
    const { info, blocks } = await snapshot(validateName(structure), undo);
    return Response.json({ ...info, blocks: Array.from(blockEntries(blocks)) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ToolError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

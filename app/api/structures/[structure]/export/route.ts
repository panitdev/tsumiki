import { exportBuild, exportFileName, formats, type Format } from "@/src/server/export";
import { attachment } from "@/src/server/attachment";
import { lastBuild, ToolError, validateName } from "@/src/server/store";
import { viewerAccess, viewerUnauthorized } from "@/src/server/viewer-access";

export const dynamic = "force-dynamic";

/** The viewer's download of the last good build. Nothing is written to the workspace. */
export async function GET(request: Request, { params }: { params: Promise<{ structure: string }> }) {
  if (!(await viewerAccess()).allowed) return viewerUnauthorized();
  try {
    const query = new URL(request.url).searchParams;
    const format = (query.get("format") ?? "schem") as Format;
    if (!formats.includes(format)) throw new ToolError("Unsupported export format.", `Choose ${formats.join(", ")}.`);
    const { structure } = await params;
    const { info, build } = await lastBuild(validateName(structure));
    const { bytes } = await exportBuild(info.name, build, format, query.get("version") || "26.3");
    return attachment(exportFileName(info.name, format), bytes);
  } catch (error) {
    if (error instanceof ToolError) {
      return new Response(`${error.message} ${error.hint}`, { status: error.status });
    }
    throw error;
  }
}

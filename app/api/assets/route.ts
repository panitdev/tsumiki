import { serveAsset } from "../../../src/render/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return serveAsset(request, "manifest");
}

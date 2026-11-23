import type { Metadata } from "next";
import { requireViewerPage } from "../../src/server/viewer-access";
import { SiteHeader } from "../../src/viewer/site-header";
import { StructureViewer } from "../../src/viewer/structure-viewer";

export const dynamic = "force-dynamic";

type StructurePageProps = { params: Promise<{ structure: string }> };

function structureName(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function generateMetadata({ params }: StructurePageProps): Promise<Metadata> {
  const { structure } = await params;
  return { title: structureName(structure) };
}

export default async function StructurePage({ params }: StructurePageProps) {
  const { structure } = await params;
  const name = structureName(structure);
  await requireViewerPage(`/${encodeURIComponent(name)}`);
  return (
    <>
      <SiteHeader />
      <StructureViewer key={name} name={name} />
    </>
  );
}

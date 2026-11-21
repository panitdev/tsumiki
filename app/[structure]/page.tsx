import type { Metadata } from "next";
import { SiteHeader } from "../../src/viewer/site-header";
import { StructureViewer } from "../../src/viewer/structure-viewer";

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
  return (
    <>
      <SiteHeader />
      <StructureViewer key={name} name={name} />
    </>
  );
}

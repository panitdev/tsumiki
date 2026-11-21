import { StructureList } from "../src/viewer/structure-list";
import { SiteHeader } from "../src/viewer/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="structure-list-page">
        <h1>Structures</h1>
        <StructureList />
      </main>
    </>
  );
}

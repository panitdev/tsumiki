import { getTranslations } from "next-intl/server";
import { requireViewerPage } from "../src/server/viewer-access";
import { StructureList } from "../src/viewer/structure-list";
import { SiteHeader } from "../src/viewer/site-header";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireViewerPage("/");
  const t = await getTranslations();
  return (
    <>
      <SiteHeader />
      <main className="structure-list-page">
        <h1>{t("home.title")}</h1>
        <StructureList />
      </main>
    </>
  );
}

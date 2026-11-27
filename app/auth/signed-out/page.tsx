import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function SignedOutPage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto grid max-w-lg gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold">{t("auth.signedOut.title")}</h1>
      <Link href="/auth/login" prefetch={false} className="underline">{t("auth.signedOut.signIn")}</Link>
    </main>
  );
}

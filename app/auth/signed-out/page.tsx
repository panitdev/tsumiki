import Link from "next/link";

export default function SignedOutPage() {
  return (
    <main className="mx-auto grid max-w-lg gap-4 px-6 py-16">
      <h1 className="text-xl font-semibold">Signed out of Tsumiki</h1>
      <Link href="/auth/login" prefetch={false} className="underline">Sign in</Link>
    </main>
  );
}

import type { Metadata } from "next";
import { Button } from "@charlotte-ui/button";
import { Card, CardContent } from "@charlotte-ui/card";
import { getSignInFailure } from "../../../src/server/sign-in-failure";
import { Brandmark } from "../../../src/viewer/brandmark";

export const metadata: Metadata = { title: "Sign-in help", robots: { index: false, follow: false } };

export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason, title, message, code } = getSignInFailure((await searchParams).reason);

  return (
    <main className="mx-auto grid min-h-dvh max-w-lg content-center px-5 py-12">
      <Card>
        <CardContent className="grid justify-items-start gap-5 p-6 sm:p-8">
          <Brandmark />
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="leading-relaxed text-muted-foreground">{message}</p>
            {code && <p className="text-sm text-muted-foreground">Surge error code <code>{code}</code></p>}
          </div>
          <Button asChild>
            {reason === "disabled"
              ? <a href="/">Open Tsumiki</a>
              : <a href="/auth/login">{reason === "invalid_target" ? "Retry sign-in" : "Start sign-in again"}</a>}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

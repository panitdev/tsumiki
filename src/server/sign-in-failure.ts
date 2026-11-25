const signInFailures = {
  invalid_target: {
    title: "Tsumiki sign-in needs a configuration fix",
    message: "Surge rejected the resource Tsumiki requested. Ask your Tsumiki administrator to check the Surge viewer client’s allowed resources.",
    code: "invalid_target",
  },
  access_denied: {
    title: "Sign-in wasn’t completed",
    message: "Access wasn’t granted in Surge. You can start a new sign-in whenever you’re ready.",
  },
  invalid_flow: {
    title: "Start a new sign-in",
    message: "This sign-in attempt expired or couldn’t be verified. Start again from this browser.",
  },
  unavailable: {
    title: "Sign-in is temporarily unavailable",
    message: "Tsumiki couldn’t start or complete sign-in right now. Try again in a moment.",
  },
  disabled: {
    title: "Sign-in is disabled",
    message: "This Tsumiki instance has browser sign-in turned off. You can go directly to the viewer.",
  },
  failed: {
    title: "Couldn’t sign in to Tsumiki",
    message: "Tsumiki couldn’t complete sign-in with Surge. Try again, or contact your Tsumiki administrator if it keeps happening.",
  },
} satisfies Record<string, { title: string; message: string; code?: string }>;

export type SignInFailure = keyof typeof signInFailures;

export function getSignInFailure(value: string | string[] | undefined) {
  const reason = typeof value === "string" && Object.hasOwn(signInFailures, value)
    ? value as SignInFailure
    : "failed";
  const details: { title: string; message: string; code?: string } = signInFailures[reason];
  return { reason, ...details };
}

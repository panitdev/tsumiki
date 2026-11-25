import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

let starting: Promise<unknown> | null = null;

export async function startMocking() {
  // Idempotent: React StrictMode runs effects twice, and repeated
  // worker.start() calls throw "cannot configure an already enabled network".
  starting ??= worker.start({ onUnhandledFrame: "bypass" }).catch((error) => {
    starting = null;
    throw error;
  });
  await starting;
}

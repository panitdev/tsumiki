import { createHash } from "node:crypto";

export function workspaceSelection(workspace: string, subject?: string): string {
  return subject === undefined ? workspace : `oauth:${subject}:${workspace}`;
}

export function workspaceDirectory(subject: string): string {
  return createHash("sha256").update(subject).digest("hex");
}

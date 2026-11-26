import { Bash, ExecutionProfile } from "@everruns/bashkit";

export const PROJECT_DIRECTORY = "/project";
/** What Tsumiki stores per project. bashkit's own filesystem limits are fixed and much larger. */
export const MAX_PROJECT_FILES = 64;
export const MAX_PROJECT_BYTES = 1_048_576;
const MAX_STDOUT = 30_000;
const MAX_STDERR = 8_000;
const MAX_DIRECTORY_DEPTH = 8;

/** Regular files under /project, keyed by their path relative to it. */
export type ProjectFiles = Record<string, string>;

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** The files to store, or null when they are too large and the call's changes are discarded. */
  files: ProjectFiles | null;
  notes: string[];
}

function trim(output: string, limit: number): string {
  if (output.length <= limit) return output;
  return `${output.slice(0, limit)}\n[output trimmed: ${output.length - limit} more characters. Print less at once, for example sed -n '1,200p' build.js]\n`;
}

function collect(bash: Bash, notes: string[]): ProjectFiles | null {
  const files: ProjectFiles = Object.create(null);
  let count = 0;
  let bytes = 0;
  const walk = (directory: string, prefix: string, depth: number): boolean => {
    for (const { name } of bash.readDir(directory)) {
      const path = `${directory}/${name}`;
      const relative = `${prefix}${name}`;
      const { fileType, size } = bash.lstat(path);
      if (fileType === "directory" && depth < MAX_DIRECTORY_DEPTH) {
        if (!walk(path, `${relative}/`, depth + 1)) return false;
      } else if (fileType === "file") {
        bytes += size;
        if (++count > MAX_PROJECT_FILES || bytes > MAX_PROJECT_BYTES) return false;
        try {
          files[relative] = bash.readFile(path);
        } catch {
          notes.push(`${path} is not UTF-8 text and was not saved.`);
        }
      } else {
        notes.push(`${path} is not a regular file and was not saved.`);
      }
    }
    return true;
  };
  if (!bash.exists(PROJECT_DIRECTORY) || bash.lstat(PROJECT_DIRECTORY).fileType !== "directory") return files;
  return walk(PROJECT_DIRECTORY, "", 0) ? files : null;
}

/** Runs one command in a fresh in-process shell over the project's files. */
export async function runShell(files: ProjectFiles, command: string): Promise<ShellResult> {
  // A new instance each call keeps bashkit's per-session counters from building up.
  const bash = new Bash({
    profile: ExecutionProfile.Hardened,
    cwd: PROJECT_DIRECTORY,
    maxCommands: 10_000,
    maxLoopIterations: 10_000,
    maxTotalLoopIterations: 100_000,
    timeoutMs: 10_000,
  });
  bash.mkdir(PROJECT_DIRECTORY, true);
  for (const [path, content] of Object.entries(files)) {
    const target = `${PROJECT_DIRECTORY}/${path}`;
    bash.mkdir(target.slice(0, target.lastIndexOf("/")), true);
    bash.writeFile(target, content);
  }
  const result = await bash.execute(command);
  const notes: string[] = [];
  let { stderr } = result;
  if (result.error && !stderr.includes(result.error)) stderr += `${result.error}\n`;
  if (result.stdoutTruncated || result.stderrTruncated) notes.push("bashkit truncated the output of this command.");
  const collected = collect(bash, notes);
  if (!collected) {
    notes.push(`${PROJECT_DIRECTORY} holds more than ${MAX_PROJECT_FILES} files or ${MAX_PROJECT_BYTES} bytes, so none of this call's file changes were saved.`);
  }
  return {
    stdout: trim(result.stdout, MAX_STDOUT), stderr: trim(stderr, MAX_STDERR),
    exitCode: result.exitCode, files: collected, notes,
  };
}

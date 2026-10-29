// Saved runs. Your own live runs land in runs/ (gitignored). The repo ships one recorded run of each
// kind in replay/, so "Start" works on a fresh clone with no API key and no internet.
import { existsSync, readFileSync, readdirSync } from "node:fs";

const DIRS = ["runs", "replay"];

/** Every saved run whose file name starts with prefix, newest first, your own runs before the shipped ones. */
export function savedRuns(prefix: string): { file: string; path: string }[] {
  return DIRS.flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().reverse().map((file) => ({ file, path: `${dir}/${file}` }))
      : [],
  );
}

/** The run "Start" replays for this prefix: your newest live run, else the recorded one. */
export function latestRun(prefix: string): string | undefined {
  const first = savedRuns(prefix)[0];
  return first ? readFileSync(first.path, "utf8") : undefined;
}

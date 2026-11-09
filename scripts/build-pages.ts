// Builds the live demo for GitHub Pages: the demo screen replaying the recorded runs in replay/,
// as static files. No server, no API key, no live mode. Same screen, same data as `pnpm demo`.
//
//   pnpm pages        -> dist/pages/  (open dist/pages/index.html through any static server)
//
// How: start the demo server on a spare port with a throwaway database, save every response the
// replay needs as a file, and add a small shim so the screen's /api/... calls read those files.

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const OUT = "dist/pages";
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;

/** The replay's proposal ids come from the recorded run, so the build follows whatever replay/ holds. */
const proposeRun = readdirSync("replay").filter((f) => f.startsWith("propose-")).sort().at(-1);
if (!proposeRun) throw new Error("No recorded proposal run in replay/");
const done = (JSON.parse(readFileSync(join("replay", proposeRun), "utf8")) as { events: { t: string; proposalId?: string }[] })
  .events.find((e) => e.t === "done");
const proposalId = done?.proposalId;
if (!proposalId) throw new Error("The recorded proposal run has no approved proposal");

/** Every GET the replay makes, and the file it becomes (see fileFor in the shim below). */
const GETS = [
  "/api/rules",
  "/api/setup/latest?rule=hours",
  "/api/propose/latest",
  "/api/chat/rules",
  "/api/chat/setup/latest?rule=bookings",
  "/api/chat/latest",
  `/api/proposal?id=${proposalId}`,
];

/** Same mapping as the shim: /api/setup/latest?rule=hours -> api/setup/latest__hours.json */
function fileFor(path: string): string {
  const url = new URL(path, BASE);
  const q = [...url.searchParams.values()].map((v) => v.replace(/[^a-zA-Z0-9-]/g, "_")).join("_");
  return `${url.pathname.slice(1)}${q ? `__${q}` : ""}.json`;
}

const SHIM = `<script>
// Static demo (GitHub Pages): the screen's /api calls read files saved from a recorded run.
window.SHIFTGUARD_STATIC = true;
(() => {
  const real = window.fetch.bind(window);
  const fileFor = (path) => {
    const url = new URL(path, location.origin);
    const q = [...url.searchParams.values()].map((v) => v.replace(/[^a-zA-Z0-9-]/g, "_")).join("_");
    return url.pathname.slice(1) + (q ? "__" + q : "") + ".json";
  };
  window.fetch = (input, init) => {
    const path = typeof input === "string" ? input : input.url;
    if (path.startsWith("/api/approve")) return real("api/approve.json");
    if (path.startsWith("/api/")) return real(fileFor(path));
    return real(input, init);
  };
  // Live runs need the engine and an API key; the static demo has neither.
  window.EventSource = class { constructor() { setTimeout(() => this.onerror && this.onerror(new Event("error"))); } close() {} addEventListener() {} };
})();
</script>`;

const STATIC_NOTE = `<p class="title-note">A replay of a real recorded run: free, offline, identical every time. To run it live with your own API key, <a href="https://github.com/AIwithDiego/taste-to-evals#run-it-yourself">clone the repo</a>.</p>`;

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/rules`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Demo server didn't start");
}

async function save(path: string, out: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  const file = join(OUT, out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const dbDir = mkdtempSync(join(tmpdir(), "shiftguard-pages-"));
  const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: { ...process.env, PORT: String(PORT), SHIFTGUARD_DB: join(dbDir, "pages.db"), SHIFTGUARD_TELEMETRY: "off", ANTHROPIC_API_KEY: "" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await waitForServer();
    for (const path of GETS) await save(path, fileFor(path));
    // One real Approve on the throwaway database: the static Approve button returns this answer.
    await save("/api/approve", "api/approve.json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposalId }),
    });
    await save("/styles.css", "styles.css");
    await save("/app.js", "app.js");
    for (const w of ["400", "700"]) await save(`/fonts/atkinson-${w}.woff2`, `fonts/atkinson-${w}.woff2`);
  } finally {
    server.kill();
    rmSync(dbDir, { recursive: true, force: true });
  }

  // Paths become relative, so the site works under /taste-to-evals/ on Pages.
  const css = readFileSync(join(OUT, "styles.css"), "utf8").replaceAll('url("/fonts/', 'url("fonts/');
  writeFileSync(join(OUT, "styles.css"), css + "\n#startLive{display:none}\n");
  const js = readFileSync(join(OUT, "app.js"), "utf8").replaceAll("`/evidence.pdf?id=", "`evidence.pdf?id=");
  writeFileSync(join(OUT, "app.js"), js);
  // The evidence page for the recorded run is the sample PDF in docs/.
  copyFileSync("docs/evidence-sample.pdf", join(OUT, "evidence.pdf"));

  let html = readFileSync("web/index.html", "utf8")
    .replace('href="/styles.css"', 'href="styles.css"')
    .replace('src="/app.js"', 'src="app.js"')
    .replace(/<p class="title-note">[\s\S]*?<\/p>/, STATIC_NOTE)
    .replace("</head>", `${SHIM}\n</head>`);
  if (!html.includes("SHIFTGUARD_STATIC")) throw new Error("Shim not added: index.html has no </head>");
  writeFileSync(join(OUT, "index.html"), html);
  writeFileSync(join(OUT, ".nojekyll"), "");
  console.log(`Built ${OUT}/ from ${proposeRun} (proposal ${proposalId})`);
}

await main();

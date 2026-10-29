// The demo screen's local server. Only listens on this machine.
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChatEvent, ProposeEvent, SetupEvent, SetupRecord } from "./events.js";
import { RULES, type RuleId } from "./rules.js";
import { runProposal } from "./propose.js";
import { approve, getProposal } from "./store.js";
import { baseWeek } from "./ollies.js";
import { runSetup } from "./setup.js";
import { evidenceHtml } from "./evidence.js";
import { latestRun } from "./runs.js";
import { CHAT_RULES } from "./chat/rules.js";
import { DEFAULT_CONVERSATION, runConversation } from "./chat/converse.js";
import { runChatSetup } from "./chat/setup.js";
import { reloadChatChecks } from "./chat/gate.js";
import type { ChatRuleId } from "./chat/examples.js";

/** Where Chrome lives, for printing the evidence page to PDF. Set CHROME_PATH on Linux or Windows. */
const CHROME = process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Prints the evidence page to PDF with the local Chrome (no internet, no service). */
async function evidencePdf(id: string): Promise<Buffer> {
  const out = join(mkdtempSync(join(tmpdir(), "shiftguard-")), "evidence.pdf");
  await promisify(execFile)(CHROME, [
    "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${out}`, `http://127.0.0.1:${PORT}/evidence?id=${encodeURIComponent(id)}`,
  ], { timeout: 30_000 });
  return readFileSync(out);
}

function chatRuleParam(url: URL): ChatRuleId {
  const id = url.searchParams.get("rule") ?? "bookings";
  const def = CHAT_RULES.find((r) => r.id === id);
  if (!def) throw new Error(`Unknown chatbot rule "${id}"`);
  return def.id;
}

const PORT = Number(process.env["PORT"] ?? 4321);
let liveRunning = false;

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function appJs(): Promise<string> {
  const out = await build({ entryPoints: ["web/main.ts"], bundle: true, format: "esm", target: "es2022", write: false, sourcemap: "inline" });
  const file = out.outputFiles[0];
  if (!file) throw new Error("Screen script didn't build");
  return file.text;
}

function ruleParam(url: URL): RuleId {
  const id = url.searchParams.get("rule") ?? "hours";
  const def = RULES.find((r) => r.id === id);
  if (!def) throw new Error(`Unknown rule "${id}"`);
  return def.id;
}

/** Which saved run "Start" replays: your newest live run of that kind, else the one recorded in replay/. */
const latest = latestRun;

/** From a saved setup run: the interview's opening question, her first answer, and how the check did on her examples.
 *  The screen plays this for the rules that aren't interviewed live, so every note on stage has a visible source. */
function fromSetup(run: string | undefined) {
  if (!run) return { story: null, right: 0, total: 0 };
  const events = (JSON.parse(run) as SetupRecord).events;
  const lines = events.flatMap((e) => (e.t === "line" ? [e.line] : []));
  const ask = lines.find((l) => l.who === "interviewer")?.text;
  const answer = lines.find((l) => l.who === "owner")?.text;
  const outcomes = events.filter((e) => e.t === "outcome");
  const right = outcomes.filter((e) => e.t === "outcome" && e.outcome.ok).length;
  return { story: ask && answer ? { ask, answer } : null, right, total: outcomes.length };
}

/** The owner's rules as the hub shows them: handwritten until set up, then the captured title and how it's checked. */
function rulesForHub() {
  return RULES.map((r) => {
    const file = `checks/${r.id}.rule.json`;
    const spec = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    return { id: r.id, handwritten: r.handwritten, title: spec?.title ?? null, by: r.kind === "judged" ? "judge" : "code", ...fromSetup(latestSetup(r.id)) };
  });
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

function latestSetup(rule: RuleId): string | undefined {
  return latest(`setup-${rule}-`);
}

/** Her chatbot rules for the screen, with how each did on her replies at setup (from the latest setup run). */
function chatRulesForHub() {
  return CHAT_RULES.map((r) => {
    const file = `checks/chat-${r.id}.rule.json`;
    const spec = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    return { id: r.id, handwritten: r.handwritten, title: spec?.title ?? null, by: r.kind === "judged" ? "judge" : "code", ...fromSetup(latest(`chat-setup-${r.id}-`)) };
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    switch (url.pathname) {
      case "/":
        return send(res, 200, "text/html; charset=utf-8", readFileSync("web/index.html"));
      case "/styles.css":
        return send(res, 200, "text/css; charset=utf-8", readFileSync("web/styles.css"));
      case "/app.js":
        return send(res, 200, "text/javascript; charset=utf-8", await appJs());
      case "/fonts/atkinson-400.woff2":
      case "/fonts/atkinson-700.woff2":
        return send(res, 200, "font/woff2", readFileSync(`web${url.pathname}`));
      case "/api/setup/latest": {
        const run = latestSetup(ruleParam(url));
        return run ? send(res, 200, "application/json", run) : send(res, 404, "application/json", JSON.stringify({ error: "No saved run yet. Press Start live once." }));
      }
      case "/api/setup/live": {
        if (liveRunning) return send(res, 409, "application/json", JSON.stringify({ error: "A live run is already going." }));
        liveRunning = true;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        const emit = (e: SetupEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        try {
          await runSetup(ruleParam(url), emit);
        } catch {
          // runSetup already sent an error event to the screen
        } finally {
          liveRunning = false;
          res.end();
        }
        return;
      }
      case "/api/rules":
        return send(res, 200, "application/json", JSON.stringify(rulesForHub()));
      case "/api/propose/latest": {
        const run = latest("propose-");
        return run ? send(res, 200, "application/json", run) : send(res, 404, "application/json", JSON.stringify({ error: "No saved run yet. Press Start live once." }));
      }
      case "/api/propose/live": {
        if (liveRunning) return send(res, 409, "application/json", JSON.stringify({ error: "A live run is already going." }));
        const request = (url.searchParams.get("request") ?? "").trim().slice(0, 500);
        if (!request) return send(res, 400, "application/json", JSON.stringify({ error: "Type what you need first." }));
        liveRunning = true;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        const emit = (e: ProposeEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        try {
          await runProposal(request, emit);
        } catch {
          // runProposal already sent an error event to the screen
        } finally {
          liveRunning = false;
          res.end();
        }
        return;
      }
      case "/evidence": {
        const html = evidenceHtml(url.searchParams.get("id") ?? "");
        return html ? send(res, 200, "text/html; charset=utf-8", html) : send(res, 404, "text/plain", "No saved run ends with that proposal.");
      }
      case "/evidence.pdf": {
        const id = url.searchParams.get("id") ?? "";
        if (!evidenceHtml(id)) return send(res, 404, "text/plain", "No saved run ends with that proposal.");
        res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `inline; filename="shiftguard-evidence-${id.replace(/[^a-z0-9]/gi, "")}.pdf"`, "cache-control": "no-store" });
        res.end(await evidencePdf(id));
        return;
      }
      case "/api/chat/rules":
        return send(res, 200, "application/json", JSON.stringify(chatRulesForHub()));
      case "/api/chat/setup/latest": {
        const run = latest(`chat-setup-${chatRuleParam(url)}-`);
        return run ? send(res, 200, "application/json", run) : send(res, 404, "application/json", JSON.stringify({ error: "No saved chatbot setup yet." }));
      }
      case "/api/chat/setup/live": {
        if (liveRunning) return send(res, 409, "application/json", JSON.stringify({ error: "A live run is already going." }));
        liveRunning = true;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        const emit = (e: SetupEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        try {
          await runChatSetup(chatRuleParam(url), emit);
          reloadChatChecks();
        } catch {
          // runChatSetup already sent an error event to the screen
        } finally {
          liveRunning = false;
          res.end();
        }
        return;
      }
      case "/api/chat/latest": {
        // Conversation runs are "chat-<timestamp>.json"; setup runs are "chat-setup-...".
        const run = latest("chat-2");
        return run ? send(res, 200, "application/json", run) : send(res, 404, "application/json", JSON.stringify({ error: "No saved conversation yet." }));
      }
      case "/api/chat/live": {
        if (liveRunning) return send(res, 409, "application/json", JSON.stringify({ error: "A live run is already going." }));
        liveRunning = true;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        const emit = (e: ChatEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        try {
          await runConversation(DEFAULT_CONVERSATION, emit);
        } catch {
          // runConversation already sent an error event to the screen
        } finally {
          liveRunning = false;
          res.end();
        }
        return;
      }
      case "/api/proposal": {
        const found = getProposal(url.searchParams.get("id") ?? "");
        if (!found) return send(res, 404, "application/json", JSON.stringify({ error: "No such proposal" }));
        return send(res, 200, "application/json", JSON.stringify({ ...found, baseShiftIds: baseWeek().shifts.map((x) => x.id) }));
      }
      case "/api/approve": {
        if (req.method !== "POST") return send(res, 405, "application/json", JSON.stringify({ error: "Use POST" }));
        const { proposalId } = JSON.parse((await readBody(req)) || "{}");
        if (typeof proposalId !== "string" || !proposalId) return send(res, 400, "application/json", JSON.stringify({ ok: false, message: "Which proposal?" }));
        const result = await approve(proposalId, "Gráinne");
        return send(res, result.ok ? 200 : 409, "application/json", JSON.stringify(result));
      }
      default:
        return send(res, 404, "text/plain", "Not found");
    }
  } catch (err) {
    send(res, 500, "text/plain", err instanceof Error ? err.message : String(err));
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`ShiftGuard demo on http://localhost:${PORT}`));

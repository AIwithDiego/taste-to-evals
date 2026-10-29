# How it works

A walk through the code, in the order things happen. File names are relative to the repo root.

## 1. The owner and her world

Everything starts from `data/ollies/`:

- `owner-notes.md`: Gráinne's notes, written as she'd talk. Each rule has a section and a "what went wrong" story. This is the only thing the role-played owner is allowed to answer from.
- `staff.json`: seven people, their role, whether they're trained on the coffee machine, contract hours, and the days they've said they can't work.
- `weekend-history.json`: weekend shifts each person worked in the last four weeks (the fairness judge needs it).
- `menu.json` and `allergens.json`: the public menu page the chatbot reads, and the allergen sheet only the checks read.

The shapes are in `src/domain.ts` (`Staff`, `Shift`, `Rota`, `Violation`) and `src/chat/domain.ts` (`Shop`, `Claims`). A check is always a pure function: `check(rota) => Violation[]` for the rota, `check({ claims, shop }) => Violation[]` for the chat. A `Violation` is one sentence the owner would say: "Tom would work 48 hours. Your limit is 40."

## 2. Setup: from a story to a proven check

`src/setup.ts` `runSetup(ruleId)` runs one rule end to end. `src/rules.ts` lists the six rota rules as she'd scribble them ("Nobody over 40 hours a week") with what the interviewer should ask about.

1. **Interview** (`src/interview.ts`). One Claude plays the interviewer and opens with a time it went wrong. A second Claude plays Gráinne, answering only from her notes. The result is a typed `RuleSpec`: her words, the precise rule, exceptions, and whether code can decide it (`typed`) or it needs judgement (`judged`), with the reason.
2. **Write** (`src/generate.ts`). For a typed rule, Claude writes `export function check(rota)` from the precise rule plus two extra test weeks of its own. The code is saved to `checks/<rule>.ts` and must pass `tsc`.
3. **Prove**. The check runs against the owner's example weeks (`src/examples.ts`: weeks she calls fine and weeks she doesn't, each with the reason) and Claude's two. It has to get every one right; otherwise Claude gets the failures and tries again, up to three times.
4. **Judged rules** (`src/judge.ts`). For "weekends shared fairly", Claude writes a rubric (`checks/fair.rubric.json`: criteria, fine when, not fine when) and the judge is run on her example weeks. It has to agree with her on all of them.
5. **Save**. `checks/<rule>.rule.json` keeps her words, the precise rule, why it's code or judge, and a plain description of how the check works. The whole run (every line of the interview, every outcome, every Claude call and its cost) is saved to `runs/setup-<rule>-<time>.json`.

The chatbot rules go through the same steps in `src/chat/setup.ts`, with replies she judged instead of weeks.

## 3. The sandbox

`src/sandbox.ts` is how a check Claude wrote gets run:

- `screen()` refuses source that mentions anything that could reach outside: `import`, `require`, `process`, `globalThis`, `eval`, `Function`, `fetch`, `constructor`, `prototype`, timers, `Reflect`, `Proxy` and similar. It must export `check`.
- `compile()` strips the types with esbuild and runs the code in a `node:vm` context that contains only `module` and `exports`, with code generation from strings disabled and a one-second timeout.
- Input goes in as a JSON string and results come out as one, so no object references cross the boundary.

This is defence in depth for a local demo. `node:vm` isn't a security boundary; production would use a separate process or an isolate.

## 4. A request, the assistant and the gate

`src/propose.ts` `runProposal(request)`:

1. **Facts first** (`src/request.ts`). Claude reads the request ("Sarah's got the flu and she's out all week") and notes absences as facts on the week, so the availability rule applies to every draft.
2. **The assistant drafts** (`src/agent.ts`). `RotaAssistant` has two tools, `read_week` and `read_staff`. Its prompt doesn't contain the owner's rules and says it can't save. It returns a list of changes.
3. **The gate** (`src/gate.ts` `runGate`). The changes are applied to a copy of the week (`applyChange`). Every typed check runs in the sandbox. If any fail, the judge is marked "not asked" and the draft goes back.
4. **Feedback**. The assistant hears only the violation sentences, never the rules, and drafts again. Up to five rounds.
5. **The judge**. Once every code check passes, the judge weighs fairness with the rubric and the last four weeks of weekend history, and gives a verdict with a reason.
6. **Record** (`src/store.ts` `recordProposal`). Every try is stored in SQLite (`runs/shiftguard.db`) with its gate result. The run is saved to `runs/propose-<time>.json`.

## 5. Approve: the only write

`src/store.ts` `approve(proposalId, approvedBy)`:

- refuses a proposal that didn't pass,
- re-runs every code check on the stored rota instead of trusting the stored result (the judge's verdict is taken from the run, because it's an AI call),
- writes the rota into `approved_rotas` once; approving again changes nothing and says so.

`src/agent.test.ts` fails the build if the assistant gets a tool whose name doesn't start with `read_`, imports the store, or touches the file system or SQLite.

## 6. The chatbot act

`src/chat/converse.ts` runs a conversation:

1. **The bot drafts** (`src/chat/bot.ts`). It reads the public menu page, not the allergen sheet, and isn't given her rules. It can't send anything.
2. **Claude reads the promises** (`src/chat/claims.ts`). A separate call lists only what the draft promises: items said to be safe for an allergen, discounts, bookings (party size, day, time).
3. **Her checks decide** (`src/chat/gate.ts`). The typed `checks/chat-*.ts` run on those promises and the shop's facts, in the same sandbox. Tone ("sound like us") goes to the judge last.
4. **Deliver or retry** (`src/store.ts` `deliver`). A passing reply is delivered by code that re-runs the checks first. A stopped draft goes back to the bot with only what broke. After three stopped drafts, `holdForOwner()` sends a fixed holding line and keeps the question for Gráinne.

## 7. Evidence

`src/evidence.ts` builds one page per rota run from the saved run and the store: what was asked, the facts noted, every try with what each rule said, the judge's reason, who approved and when, how each rule was proven, the controls, and the cost. `/evidence.pdf` prints it with the local Chrome (set `CHROME_PATH` if it isn't in the macOS default place). See [the sample](evidence-sample.pdf).

## 8. The MCP server

`src/mcp.ts` exposes the same gate over stdio: `read_rules`, `read_week`, `read_staff`, `check_rota_change` and `check_chat_reply`. All are annotated read-only. It has no tool that saves or sends, so any MCP client has to pass the gate and still can't act on its own.

## 9. The demo screen

`src/server.ts` serves `web/` on `127.0.0.1:4321` and bundles `web/main.ts` with esbuild on each request. **Start** replays a saved run (`src/runs.ts`: your newest in `runs/`, else the recorded one in `replay/`). **Start live** streams a real run over server-sent events. The story is presenter-paced: each moment waits for →, Space or a click, and Approve is a real call to `/api/approve`. Fonts are served locally so it looks the same offline.

URL options: `?act=rota|chat|both` picks the act, `?start=1` skips the title card, `?auto=1` advances by itself (used to record the GIFs).

## 10. Telemetry

`src/telemetry.ts` is off unless `SHIFTGUARD_TELEMETRY=on` and a PostHog key are set. When on, each live run is one PostHog trace: every Claude call is an `$ai_generation` with tokens, cost and latency, each check is an `$ai_span`, and events (`shiftguard_check`, `shiftguard_gate_run`, `shiftguard_approved`, `shiftguard_reply_sent`, `shiftguard_reply_held`, `shiftguard_rule_setup`) record outcomes by rule.

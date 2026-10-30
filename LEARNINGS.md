# What I learned building taste-to-evals

I built this in about a week in October 2026 for a five-minute slot at AI Tinkerers Dublin (28 Oct). These notes cover what worked, what surprised me, and what I'd do differently. The decisions behind them are in [`docs/decisions/`](docs/decisions/).

## About getting rules out of people

**Ask about the bad week, not the rule.** The first version of the interview asked Gráinne for her rules and some examples. Owners don't think in rules, though; they remember the week it went wrong. When I changed the opening question to "tell me about a time a rota went wrong", every rule came with a number, a boundary and an exception: Tom did 46 hours covering for Niamh and dropped a tray, so the rule is 40, breaks counted, exactly 40 is fine, no exception for sick cover. Stories carry the edge cases that rule statements leave out.

**A rule isn't a rule until it has examples.** Every check is run against weeks the owner calls fine and weeks she doesn't, plus two edge cases Claude writes itself, and it has to get all of them right before it guards anything. It also caught a bug of mine, not the model's: the weekend history for the example weeks never reached the AI judge, and the examples were what showed it.

**Some rules shouldn't be code, and that's fine if you say so.** "Weekends shared fairly" has no formula. Gráinne said it herself: one more weekend for someone isn't a crime, she just doesn't want the same people carrying it. That rule became a rubric for an AI judge, and it's labelled "AI judge" everywhere it appears, so the owner always knows which rules are checked and which are judged.

## About the gate

**Code first, judge last.** Typed checks run first, in milliseconds, with the same answer every time. The judge is asked only when they all pass. The model never gets a vote on something arithmetic can settle, and judge calls (the slow, costly, less predictable part) only happen on drafts that are already plausible.

**Don't give the acting agent the rules.** This one surprised me. With Gráinne's rules in its prompt, the rota assistant never broke one (4 out of 4 runs). That looks like a win, but it hides the point. The agent acting on your business is often a vendor's, with a prompt you don't control. So the rules live in one place, outside any agent, and the agent only hears what broke: "Tom would work 48 hours. Your limit is 40."

**Turn the request into facts before the agent starts.** "Sarah's out all week with the flu" was only a sentence in the request at first, and a draft that left Sarah on the rota (or changed nothing) passed every check. Now the request is read first and Sarah's absence is written onto the week, so the existing "can't work that day" rule holds every draft to it. What the gate checks against has to include what the human just said.

**Only one thing writes, and it doesn't trust anyone.** The assistant has two read-only tools. Approve is the only code that saves a rota, and it re-runs every check rather than trusting the stored "passed". Tests fail if the agent is ever given a tool that isn't read-only or can reach the database. That's cheap to enforce and it makes the safety story one sentence long.

**Keep a second opinion on the generated checks.** I hand-wrote reference versions of each rule (`src/reference.ts`) and compared them with the ones Claude wrote. They agreed on all 13 proposals and all 32 stored weeks I compared. Without that I'd only have had the model's word that its own code was right.

## About the chatbot act

**Claude reads, code decides.** Code can't reliably read a free-text reply, and an LLM shouldn't be the one deciding whether a booking for 10 at 7:30pm is allowed. So Claude extracts only what a reply promises (an allergen claim, a discount, a booking), and Gráinne's typed checks rule on those promises. Same reply, same promises, same answer.

**The safety net mattered even when the model was good.** I tried to get Claude, set up as a literal menu bot, to call the banana bread nut-free (the incident in her notes). It wouldn't: it told the customer to check with staff every time. I kept the allergen check anyway. Your vendor's bot may not be Claude, and the gate doesn't care which model it is. The catch on stage became the booking instead.

**When customers can't wait, the gate is the approval.** No human can approve each chat message. A reply that passes goes out in about a second; one that fails goes back to the bot with only what broke; after three failures the customer gets a holding line and the question goes to Gráinne. Whatever can't pass goes to a person.

## About the generated code

**Run it like you don't trust it.** The checks Claude writes are screened for anything that could reach outside (imports, `process`, `eval`, timers, network names) and run in an empty `node:vm` context with a one-second limit. For a local demo on synthetic data that's enough. `node:vm` isn't a real security boundary, so a production version would run them in a separate process or isolate and have a person review each check before it guards anything.

**Generated code should be readable.** Some checks came back as a single long line. They worked, but nobody could review them. In this repo they're formatted for reading; next time the generator should format on save, because a check the owner's developer can't read is a check nobody will trust.

## About demoing it

**Make the replay the default.** The demo screen plays back a recorded run, with no API key and no internet, and "Start live" is one click away. Venue wifi was never going to decide whether the demo worked.

**Plain language on the surface, detail one click away.** The audience was mixed. On screen: names, hours, days, and one sentence per broken rule. The check code, the judge's reasoning, the cost of every call and the trace all live behind "Technical detail" and in the evidence page.

**What the room asked.** The questions on the night were about reach: does this only work for rotas, does it carry over to chatbots, and where else could the gate sit? The chatbot act answered the second one. The README answers the third with a few places the same pattern fits: refunds, purchasing, bookings, outbound email, pricing. The common shape is an agent that proposes, rules the owner can tell stories about, and one path that writes.

## What I'd do next

- Make the domain pluggable: owner notes, domain types and a gate adapter per business, with the interview, prove, gate and approve loop shared.
- Run generated checks in an isolate, and add an owner-facing review step before a new check goes live.
- Let the owner disagree with a verdict, and turn every disagreement into a new example week, so the rules keep learning from the bad weeks that come next.

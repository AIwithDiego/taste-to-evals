# The assistant doesn't get the owner's rules; requests are noted as facts first

**Date:** 20 Oct 2026

1. **The rota assistant is not given Gráinne's rules.** It stands in for any scheduling AI a café might use (a vendor's app, a general chatbot), which won't know her rules either. Her rules live in the gate; the assistant learns them only when the gate sends a draft back with what broke. In testing, with the rules in its prompt it never broke one (4 of 4 runs). That looks like good news, but it hides the point: you rarely control the prompt of the agent acting on your business.
2. **Facts in a request are noted before the assistant starts.** "Sarah's out all week" becomes "Sarah can't work Mon to Sun: flu" on the week, so the existing availability rule holds every draft to it. Without this, a draft that left Sarah on the rota (or changed nothing at all) passed every check.
3. **Approve re-runs every check itself** instead of trusting the stored result, and is the only code that writes a rota. Tests fail if the assistant is given a tool that isn't read-only or can reach the store.
4. **Model:** Claude Haiku 5.5 for every call. Fast and cheap enough to run the whole thing live on stage.

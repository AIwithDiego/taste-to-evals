// Runs a check that Claude wrote. The code never gets to touch the machine:
// it's screened for anything beyond plain logic, compiled, then run in an empty context with a time limit.
import { transform } from "esbuild";
import vm from "node:vm";
import type { Violation } from "./domain.js";

const FORBIDDEN = [
  "import", "require", "process", "globalThis", "global", "eval", "Function", "fetch",
  "constructor", "__proto__", "prototype", "setTimeout", "setInterval", "Reflect", "Proxy",
  "WebAssembly", "Atomics", "SharedArrayBuffer",
];

export function screen(code: string): string[] {
  const problems = FORBIDDEN.filter((word) => new RegExp(`\\b${word}\\b`).test(code)).map((w) => `uses "${w}"`);
  if (!/export\s+function\s+check\s*\(/.test(code)) problems.push('must define "export function check(...): Violation[]"');
  return problems;
}

/** Compiles a check. The input (a week's rota, or a reply's promises plus the shop's facts) goes in as plain JSON. */
export async function compile<I = import("./domain.js").Rota>(code: string): Promise<(input: I) => Violation[]> {
  const problems = screen(code);
  if (problems.length) throw new Error(`Check refused: ${problems.join("; ")}`);
  const { code: js } = await transform(code, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({ module, exports: module.exports }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(js).runInContext(context, { timeout: 1000 });
  const check = module.exports["check"];
  if (typeof check !== "function") throw new Error("Check didn't export a function called check");
  return (input: I): Violation[] => {
    // Pass the input in as plain JSON so the check can't reach anything outside it.
    context["__input"] = JSON.stringify(input);
    const out = new vm.Script("JSON.stringify(module.exports.check(JSON.parse(__input)))").runInContext(context, { timeout: 1000 });
    const parsed: unknown = JSON.parse(String(out));
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "object" && v !== null && typeof v.message === "string")) {
      throw new Error("Check must return a list of { message } objects");
    }
    return parsed;
  };
}

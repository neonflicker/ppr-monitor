/* Static check: report hooks declared after an early `return` in a function. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HOOKS =
  /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useContext|useAction|useQuery|useNavigate|useSearchParams)\s*[(<]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "_generated" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

let bad = 0;
for (const file of walk("src")) {
  const lines = readFileSync(file, "utf8").split("\n");
  let seenReturn = false;
  lines.forEach((line, i) => {
    // Crude but effective: a render early-return (`return (`, `return null`,
    // `return <...>`). Skips effect cleanups `return () => ...`.
    const trimmed = line.trim();
    void trimmed;
    if (/^ {0,4}return\s*\(\)\s*=>/.test(line)) {
      // effect cleanup — not a render return
    } else if (/^ {0,4}return\s*(\(|null|<>|<)/.test(line)) {
      seenReturn = true;
    }
    if (seenReturn && HOOKS.test(line)) {
      console.log(`${file}:${i + 1}  hook after early return → ${line.trim()}`);
      bad++;
    }
    if (/^ {2}(export )?function |^ (export )?function /.test(line)) seenReturn = false;
    if (/^}/.test(line)) seenReturn = false;
  });
}
console.log(bad === 0 ? "OK: no hooks after early returns" : `${bad} problem(s) found`);

/**
 * Unit tests for the Notice Board rules (§14/§20): normalisation of admin
 * input and the reorder helper used by the ↑/↓ controls.
 * Run: bun scripts/test-notices.ts
 */
import {
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  moveWithin,
  normalizeNotice,
} from "../src/convex/lib/noticeRules.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

/* ---------------- normalizeNotice ---------------- */

{
  const r = normalizeNotice(undefined, "  PPR vaccination is in progress.  ");
  check("trims leading/trailing whitespace", r.ok && r.content === "PPR vaccination is in progress.");
  check("title omitted when not provided", r.ok && r.title === undefined);
}

{
  const r = normalizeNotice(null, "");
  check("blank content rejected", !r.ok && r.error === "Notice content is required.");
}

{
  const r = normalizeNotice(undefined, "   \n\t  \n ");
  check("whitespace-only content rejected", !r.ok);
}

{
  const r = normalizeNotice(undefined, "• First line\n• Second line");
  check(
    "strips admin-typed leading bullets per line",
    r.ok && r.content === "First line\nSecond line",
    r,
  );
}

{
  const r = normalizeNotice(undefined, "Line one\r\nLine two\rLine three");
  check("normalises CRLF / CR to LF", r.ok && r.content === "Line one\nLine two\nLine three");
}

{
  const r = normalizeNotice(undefined, "First\n\nSecond");
  check("preserves blank line breaks", r.ok && r.content === "First\n\nSecond");
}

{
  const r = normalizeNotice(undefined, "x".repeat(MAX_CONTENT_LENGTH));
  check("content at the limit is accepted", r.ok);
}

{
  const r = normalizeNotice(undefined, "x".repeat(MAX_CONTENT_LENGTH + 1));
  check("content over the limit is rejected", !r.ok);
}

{
  const r = normalizeNotice("  Boginadi update  ", "Body");
  check("trims the optional title", r.ok && r.title === "Boginadi update");
}

{
  const r = normalizeNotice("t".repeat(MAX_TITLE_LENGTH + 1), "Body");
  check("title over the limit is rejected", !r.ok);
}

{
  // Hyphens inside real list text must survive (only • is stripped).
  const r = normalizeNotice(undefined, "- negative sign stays");
  check("hyphen-prefixed text untouched", r.ok && r.content === "- negative sign stays");
}

/* ---------------- moveWithin ---------------- */

{
  const list = ["a", "b", "c"];
  check("move down swaps neighbours", JSON.stringify(moveWithin(list, 0, "down")) === '["b","a","c"]');
  check("move up swaps neighbours", JSON.stringify(moveWithin(list, 2, "up")) === '["a","c","b"]');
  check("move up at top returns null", moveWithin(list, 0, "up") === null);
  check("move down at bottom returns null", moveWithin(list, 2, "down") === null);
  check("bad index returns null", moveWithin(list, 9, "up") === null);
  check("original array not mutated", JSON.stringify(list) === '["a","b","c"]');
}

/* ---------------- summary ---------------- */

console.log(`\nnotices: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

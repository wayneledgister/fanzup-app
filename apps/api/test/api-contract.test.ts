/**
 * Wire-contract drift guard (docs/API.md). Every registered route must be listed in the reference table, and every
 * listed route must exist. No database needed: the app is built with lazy connections and never serves a request.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectRoutes } from "../src/lib/route-inventory";

const DOC = join(import.meta.dirname, "../../../docs/API.md");

function documentedRoutes(): string[] {
  const text = readFileSync(DOC, "utf8");
  const start = text.indexOf("<!-- routes:start");
  const end = text.indexOf("<!-- routes:end -->");
  expect(start, "docs/API.md is missing its routes:start marker").toBeGreaterThan(-1);
  expect(end, "docs/API.md is missing its routes:end marker").toBeGreaterThan(start);
  const rows: string[] = [];
  for (const line of text.slice(start, end).split("\n")) {
    const m = line.match(/^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|/);
    if (m) rows.push(`${m[1]} ${m[2]}`);
  }
  return rows;
}

describe("API reference (docs/API.md)", () => {
  it("lists exactly the routes the API registers, once each", async () => {
    const live = (await collectRoutes()).map((r) => `${r.method} ${r.path}`);
    const documented = documentedRoutes();
    const dupes = documented.filter((r, i) => documented.indexOf(r) !== i);
    expect(dupes, "routes listed twice in docs/API.md").toEqual([]);
    const missing = live.filter((r) => !documented.includes(r));
    const stale = documented.filter((r) => !live.includes(r));
    expect(missing, "routes the API registers but docs/API.md doesn't list (add a row and update the design doc)").toEqual([]);
    expect(stale, "routes docs/API.md lists that the API no longer registers (remove the row)").toEqual([]);
  });
});

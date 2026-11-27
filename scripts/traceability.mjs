#!/usr/bin/env node
/**
 * Requirements traceability matrix (SDD: specs/traceability.md). Regenerated from the artifacts, never hand-edited:
 * requirement → design → ADR → tasks → tests → code, with orphans flagged.
 *
 *   node scripts/traceability.mjs          # rewrite specs/traceability.md
 *   node scripts/traceability.mjs --check  # exit 1 if specs/traceability.md is out of date (CI)
 *
 * A requirement is *defined* by a heading `### FR-XXX-NNN: Title` or a table row `| NFR-XXX-NN | text | Pri |` in a
 * requirements file listed in MODULES. A *reference* is any mention of the id elsewhere, including the shorthand
 * the specs use for groups: `FR-PAY-001/002/003` and `FR-MKT-003…009` (or `...`, `–`).
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "specs/traceability.md");

const MODULES = [
  { key: "Core (M1–GA)", req: "specs/01-requirements.md" },
  { key: "Layer 2 (CR-002)", req: "specs/l2/01-requirements.md" },
  { key: "Agent layer (CR-003)", req: "specs/agents/01-requirements.md" },
  { key: "Mobile (CR-004)", req: "specs/mobile/01-requirements.md" },
  { key: "Services marketplace (CR-005)", req: "specs/marketplace/01-requirements.md" },
].filter((m) => existsSync(join(ROOT, m.req)));

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".expo", ".git", "playwright-report", "test-results", ".vercel", ".turbo"]);
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).split("\\").join("/");

const CODE_EXT = [".ts", ".tsx", ".mjs", ".js", ".sql"];
const isTest = (p) => /(^|\/)(test|tests|e2e)\//.test(p) || /\.test\.(ts|tsx|mjs)$/.test(p) || /\.spec\.ts$/.test(p);
const SOURCES = {
  design: walk(join(ROOT, "specs"), [".md"]).filter((p) => /02-design\.md$/.test(p)),
  adr: walk(join(ROOT, "docs/adr"), [".md"]).filter((p) => !/README\.md$/.test(p)),
  tasks: walk(join(ROOT, "specs"), [".md"]).filter((p) => /03-tasks\.md$/.test(p)),
  code: [
    ...walk(join(ROOT, "apps"), CODE_EXT),
    ...walk(join(ROOT, "packages"), CODE_EXT),
    ...walk(join(ROOT, "supabase"), [".sql"]),
    ...walk(join(ROOT, "e2e"), [".ts"]),
    ...walk(join(ROOT, "scripts"), [".ts", ".mjs"]).filter((p) => !p.endsWith("traceability.mjs")),
  ],
};
SOURCES.tests = SOURCES.code.filter((p) => isTest(rel(p)));
SOURCES.code = SOURCES.code.filter((p) => !isTest(rel(p)));

/** Every id a text mentions, with group shorthand expanded. */
function mentions(text) {
  const ids = new Set();
  const re = /\b(N?FR-(?:[A-Z][A-Z0-9]*-)*?[A-Z][A-Z0-9]*)-(\d{2,3}[a-z]?)((?:\s*(?:\/|…|\.\.\.|–)\s*\d{2,3}[a-z]?)*)/g;
  let m;
  while ((m = re.exec(text))) {
    const [, prefix, first, rest] = m;
    const width = first.replace(/[a-z]$/, "").length;
    ids.add(`${prefix}-${first}`);
    if (!rest) continue;
    const parts = rest.split(/(\/|…|\.\.\.|–)/).map((s) => s.trim()).filter(Boolean);
    let prev = parseInt(first, 10);
    for (let i = 0; i < parts.length; i += 2) {
      const sep = parts[i];
      const n = parts[i + 1];
      if (!n) break;
      const v = parseInt(n, 10);
      if (sep === "/") ids.add(`${prefix}-${n}`);
      else for (let k = prev + 1; k <= v && k - prev < 50; k++) ids.add(`${prefix}-${String(k).padStart(width, "0")}`);
      prev = v;
    }
  }
  return ids;
}

const index = {};
for (const [kind, files] of Object.entries(SOURCES)) {
  index[kind] = files.map((p) => ({ path: rel(p), ids: mentions(readFileSync(p, "utf8")) }));
}
const refs = (kind, id) => index[kind].filter((f) => f.ids.has(id)).map((f) => f.path);

function definitions(file) {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  const defs = [];
  const seen = new Set();
  lines.forEach((line, i) => {
    let m = line.match(/^#{2,4}\s+(N?FR-[A-Z0-9-]+?-\d{2,3}[a-z]?)\s*[:—-]\s*(.+)$/);
    if (m && !seen.has(m[1])) {
      const pri = lines.slice(i + 1, i + 15).join("\n").match(/\*\*Priority:\*\*\s*([^·\n]+)/);
      defs.push({ id: m[1], title: m[2].trim(), pri: pri ? pri[1].trim() : "" });
      seen.add(m[1]);
      return;
    }
    m = line.match(/^-\s+\*\*(N?FR-[A-Z0-9-]+?-\d{2,3}[a-z]?)\s+([^:*]+):?\*\*/);
    if (m && !seen.has(m[1])) {
      defs.push({ id: m[1], title: m[2].trim(), pri: "" });
      seen.add(m[1]);
      return;
    }
    m = line.match(/^\|\s*(N?FR-[A-Z0-9-]+?-\d{2,3}[a-z]?)\s*\|\s*([^|]+)\|\s*([^|]*)\|/);
    if (m && !seen.has(m[1])) {
      const pri = /^P\d|^post|^GA|^M\d/i.test(m[3].trim()) ? m[3].trim() : "";
      defs.push({ id: m[1], title: m[2].replace(/\*\*/g, "").trim(), pri });
      seen.add(m[1]);
    }
  });
  return defs;
}

const short = (title) => {
  const t = title.replace(/`/g, "").replace(/\s+/g, " ");
  return t.length > 90 ? `${t.slice(0, 87).trimEnd()}…` : t;
};
const list = (paths, max = 3) => {
  if (!paths.length) return "—";
  const names = paths.map((p) => `\`${p.replace(/^apps\/|^packages\//, "").replace(/^specs\//, "")}\``);
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
};

let total = 0;
const counts = { tested: 0, code: 0, planned: 0, specOnly: 0 };
const orphanTasks = [];
const sections = [];
const definedAll = new Set();
for (const mod of MODULES) {
  const defs = definitions(mod.req);
  const rows = defs.map((d) => {
    definedAll.add(d.id);
    const design = refs("design", d.id);
    const adr = refs("adr", d.id);
    const tasks = refs("tasks", d.id);
    const tests = refs("tests", d.id);
    const code = refs("code", d.id);
    let status;
    if (tests.length) { status = "✅ tested"; counts.tested++; }
    else if (code.length) { status = "🟡 code, no test ref"; counts.code++; }
    else if (tasks.length || design.length) { status = "⏳ designed/planned"; counts.planned++; }
    else { status = "⚠️ spec only"; counts.specOnly++; }
    total++;
    return `| ${d.id} | ${short(d.title).replace(/\|/g, "\\|")} | ${(d.pri.split(/[\s(]/)[0] || "—").replace(/\|/g, "")} | ${list(design)} | ${list(adr)} | ${list(tasks)} | ${list(tests)} | ${list(code)} | ${status} |`;
  });
  sections.push(`### ${mod.key} · \`${mod.req}\` · ${defs.length} requirements\n| ID | Requirement | Pri | Design | ADR | Tasks | Tests | Code | Status |\n|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}`);
}
// Work nothing required: ids cited in tasks/design/code that no requirements file defines.
const cited = new Map();
for (const kind of ["design", "tasks", "code", "tests"]) for (const f of index[kind]) for (const id of f.ids) {
  if (definedAll.has(id)) continue;
  if (!cited.has(id)) cited.set(id, new Set());
  cited.get(id).add(f.path);
}
for (const [id, files] of [...cited].sort()) orphanTasks.push(`| ${id} | ${list([...files], 4)} |`);

const out = `# Requirements traceability matrix
**Owner:** engineering · **Status:** active (generated) · **Generated from:** ${MODULES.map((m) => `\`${m.req}\``).join(", ")}

> Generated by \`node scripts/traceability.mjs\` — **do not edit by hand**. CI runs \`node scripts/traceability.mjs --check\` and fails when this file is stale, so a PR that adds a requirement, a task, a test or code citing an id regenerates it in the same PR.

**How to read it.** A reference is any mention of the requirement id (group shorthand such as \`FR-PAY-001/002\` and \`FR-MKT-003…009\` is expanded). *Tests* = test files (\`test/\`, \`e2e/\`, \`*.test.ts\`); *Code* = source, migrations and scripts. Status is the strongest evidence found: **✅ tested** (a test cites it) · **🟡 code, no test ref** (code cites it but no test names it — the behaviour may still be tested without the id) · **⏳ designed/planned** (in a design or task list only) · **⚠️ spec only** (nothing cites it yet: future milestones, or a gap). Citing ids in test names and comments is what moves a row to ✅.

## Summary
| Requirements | ✅ tested | 🟡 code, no test ref | ⏳ designed/planned | ⚠️ spec only |
|---|---|---|---|---|
| ${total} | ${counts.tested} | ${counts.code} | ${counts.planned} | ${counts.specOnly} |

## Matrix
${sections.join("\n\n")}

## Cited but not defined
Ids that design, tasks or code cite but no requirements file defines — a typo, a retired id, or a requirement that lives in another document (for example a council record). Each needs a requirement, a fix, or a note.
| ID | Cited in |
|---|---|
${orphanTasks.join("\n") || "| — | — |"}
`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== out) {
    console.error("specs/traceability.md is out of date. Run: node scripts/traceability.mjs");
    process.exit(1);
  }
  console.log(`specs/traceability.md is current (${total} requirements).`);
} else {
  writeFileSync(OUT, out);
  console.log(`Wrote specs/traceability.md: ${total} requirements, ${counts.tested} tested, ${counts.code} code-only, ${counts.planned} planned, ${counts.specOnly} spec-only, ${orphanTasks.length} cited-but-undefined.`);
}

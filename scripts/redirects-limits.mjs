// ═══════════════════════════════════════════════════════════════════════════════════════════
// R24 — WHAT CLOUDFLARE WILL ACTUALLY SERVE FROM _redirects, COUNTED THE WAY IT COUNTS
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// This is a mirror of Cloudflare's own parser, transcribed from
// workers-sdk/packages/workers-shared/utils/configuration/parseRedirects.ts (read 27 Aug 2026).
// It exists because the documented limits do not describe the behaviour that bit us, and
// reasoning from the docs alone produced the wrong diagnosis twice.
//
// ── THE DEFECT THIS MODULE EXISTS TO MAKE IMPOSSIBLE (measured live, 27 Aug 2026) ──────────
//
//   public/_redirects held 335 rules. Cloudflare served the first 108 and silently dropped 227.
//   The boundary was exact: rules 1-108 all 301'd, rules 109-335 all 404'd, no interleaving.
//   114 legacy story URLs — still in Google's index, all with live targets — went to 404.
//
// ── WHY, AND IT IS NOT THE REASON THE DOCS SUGGEST ─────────────────────────────────────────
//
//   The docs say 2,000 static + 100 dynamic, and "static redirects should appear before
//   dynamic redirects". They do not say what happens if you ignore the second sentence.
//   The parser does:
//
//       if (canCreateStaticRule && !from.match(SPLAT) && !from.match(PLACEHOLDER)) {
//         staticRules += 1; ...
//       } else {
//         dynamicRules += 1;
//         canCreateStaticRule = false;          // ← LATCHES, and never resets
//         if (dynamicRules > maxDynamicRules) {
//           break;                              // ← ABANDONS THE REST OF THE FILE
//         }
//       }
//
//   `canCreateStaticRule` latches false at the FIRST dynamic rule. Every rule after it is
//   counted as dynamic no matter how plainly static it is, and the 101st such rule does not
//   merely get skipped — it `break`s, throwing away everything below it unread.
//
//   Our file had exactly one dynamic rule, `/u/:handle`, at position 9. Rules 1-8 counted
//   static. Rules 9-108 counted dynamic (100 of them). Rule 109 was the 101st: break.
//   8 + 100 = 108. That is the whole of it, and it predicts the measured boundary exactly.
//
// ⛔ SO THE ORDERING RULE IS NOT A STYLE PREFERENCE. One dynamic rule near the top of a file
//    caps the WHOLE FILE at ~100 rules. Put every dynamic rule last, or lose the tail.
//
// The counts below are Cloudflare's, except maxLineLength: the parser's constant is 2000, the
// documentation says 1,000 per declaration. We guard at the documented — and stricter — figure.

export const LIMITS = { maxStatic: 2000, maxDynamic: 100, maxLineLength: 1000 };

const SPLAT_REGEX = /\*/;
const PLACEHOLDER_REGEX = /:[A-Za-z]\w*/;
const PERMITTED_STATUS_CODES = new Set([200, 301, 302, 303, 307, 308]);

/** Cloudflare classifies on the FROM side only — a placeholder in the target does not count. */
export function isDynamic(from) {
  return SPLAT_REGEX.test(from) || PLACEHOLDER_REGEX.test(from);
}

/** Turns `/u/:handle` into a matcher, so we can tell whether it shadows a static rule. */
function dynamicMatcher(from) {
  const source = from
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((part) => (part === '*' ? '.*' : /^:[A-Za-z]\w*$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`);
}

/**
 * Walks a _redirects body the way Cloudflare walks it and reports what would actually be
 * served. `served < total` means the tail is being thrown away.
 */
export function analyseRedirects(text) {
  const lines = text.split('\n');
  const invalid = [];        // lines Cloudflare would ignore outright
  const misfiled = [];       // truly-static rules counted as dynamic because the latch tripped
  const served = [];
  const seen = new Set();

  let staticCount = 0;
  let dynamicCount = 0;
  let canCreateStaticRule = true;
  let firstDynamic = null;
  let truncatedAt = null;
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    total++;
    const at = { lineNumber: i + 1, rule: total, line };

    if (truncatedAt !== null) continue;   // Cloudflare has already stopped reading

    if (line.length > LIMITS.maxLineLength) {
      invalid.push({ ...at, why: `exceeds the ${LIMITS.maxLineLength}-character limit (${line.length})` });
      continue;
    }

    const tokens = line.replace(/\s+#.*$/, '').split(/\s+/);
    if (tokens.length < 2 || tokens.length > 3) {
      invalid.push({ ...at, why: `expected 2 or 3 whitespace-separated tokens, got ${tokens.length}` });
      continue;
    }

    const [from, to, status = '302'] = tokens;

    if (!from.startsWith('/')) {
      invalid.push({ ...at, why: `the source "${from}" is not a root-relative path` });
      continue;
    }

    const dynamic = isDynamic(from);
    if (canCreateStaticRule && !dynamic) {
      staticCount++;
      if (staticCount > LIMITS.maxStatic) {
        invalid.push({ ...at, why: `over the ${LIMITS.maxStatic}-rule static limit` });
        continue;
      }
    } else {
      dynamicCount++;
      if (firstDynamic === null && dynamic) firstDynamic = at;
      // ⭑ The rule that is static in every sense but is being COUNTED dynamic, because a
      // dynamic rule above it latched the parser. This is the ordering defect, itemised.
      if (!dynamic) misfiled.push(at);
      canCreateStaticRule = false;
      if (dynamicCount > LIMITS.maxDynamic) {
        truncatedAt = at;                 // Cloudflare `break`s: everything below is unread
        continue;
      }
    }

    if (!Number.isInteger(Number(status)) || !PERMITTED_STATUS_CODES.has(Number(status))) {
      invalid.push({ ...at, why: `status "${status}" is not one of 200, 301, 302, 303, 307, 308` });
      continue;
    }
    if (seen.has(from)) {
      invalid.push({ ...at, why: `duplicate source path "${from}" — the earlier rule wins` });
      continue;
    }
    seen.add(from);
    served.push({ ...at, from, to, status: Number(status), dynamic });
  }

  // Reordering static ahead of dynamic changes precedence, so it is only safe while no dynamic
  // rule would have claimed a path a static rule now answers first.
  const shadowed = [];
  const staticFroms = served.filter((r) => !r.dynamic).map((r) => r.from);
  for (const rule of served.filter((r) => r.dynamic)) {
    const matcher = dynamicMatcher(rule.from);
    for (const from of staticFroms) {
      if (matcher.test(from)) shadowed.push({ dynamic: rule.from, static: from });
    }
  }

  const violations = [];
  if (misfiled.length) {
    violations.push({
      code: 'dynamic-before-static',
      message:
        `${misfiled.length} static rule(s) sit AFTER the first dynamic rule ` +
        `(${firstDynamic?.line.split(/\s+/)[0]}, line ${firstDynamic?.lineNumber}) and are therefore ` +
        `counted against the ${LIMITS.maxDynamic}-rule DYNAMIC limit. Move every dynamic rule to the end.`,
    });
  }
  if (dynamicCount > LIMITS.maxDynamic) {
    violations.push({
      code: 'dynamic-cap',
      message: `${dynamicCount} rules counted as dynamic, over the limit of ${LIMITS.maxDynamic}.`,
    });
  }
  if (staticCount > LIMITS.maxStatic) {
    violations.push({
      code: 'static-cap',
      message: `${staticCount} static rules, over the limit of ${LIMITS.maxStatic}. Cloudflare Bulk Redirects is the documented route past this.`,
    });
  }
  if (truncatedAt) {
    violations.push({
      code: 'truncated',
      message:
        `Cloudflare stops reading at rule ${truncatedAt.rule} (line ${truncatedAt.lineNumber}): ` +
        `"${truncatedAt.line.split(/\s+/).slice(0, 2).join(' ')}". ${total - truncatedAt.rule + 1} rule(s) are never parsed.`,
    });
  }
  for (const bad of invalid) {
    violations.push({ code: 'unparseable', message: `line ${bad.lineNumber}: ${bad.why}` });
  }
  for (const s of shadowed) {
    violations.push({
      code: 'shadowed',
      message: `dynamic rule ${s.dynamic} would also match ${s.static}, which now precedes it — precedence has changed.`,
    });
  }

  return {
    total,
    served: served.length,
    dropped: total - served.length,
    staticCount,
    dynamicCount,
    firstDynamic,
    misfiled,
    invalid,
    shadowed,
    truncatedAt,
    violations,
    rules: served,
  };
}

/**
 * The build's gate. Throws unless every rule in `text` would be served — PL-12's rule applied
 * to this file: a redirect map that silently loses its tail is the same class of defect as a
 * catalogue that silently loses its stories, and it must stop the build rather than deploy.
 */
export function assertServable(text, what = 'public/_redirects') {
  const report = analyseRedirects(text);
  if (report.violations.length === 0 && report.served === report.total) return report;

  const lines = [
    '',
    '═'.repeat(92),
    `BUILD FAILED — ${what} CANNOT BE SERVED IN FULL`,
    '═'.repeat(92),
    '',
    `  ${report.total} rules written, ${report.served} would be served, ${report.dropped} silently dropped.`,
    `  Counted as Cloudflare counts them: ${report.staticCount} static (limit ${LIMITS.maxStatic}), ` +
      `${report.dynamicCount} dynamic (limit ${LIMITS.maxDynamic}).`,
    '',
  ];
  for (const v of report.violations) lines.push(`  · [${v.code}] ${v.message}`);
  lines.push(
    '',
    '  Cloudflare latches every rule below the first dynamic one into the dynamic bucket and',
    '  ABANDONS the file at the 101st. A dynamic rule is one whose SOURCE contains * or :name.',
    '  Nothing was written — the previous file is still on disk.',
    '═'.repeat(92),
    '',
  );
  const err = new Error(lines.join('\n'));
  err.report = report;
  throw err;
}

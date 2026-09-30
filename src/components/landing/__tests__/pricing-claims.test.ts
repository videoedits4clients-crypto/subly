/**
 * Task 137421 (P19.12) — fixes the P0 finding in research/p19_11_release_candidate_gap_audit.md
 * §5: pricing.tsx used to advertise fictional, unimplemented commercial entitlements (fake
 * project/video-length limits, a non-existent watermark, team seats, priority rendering) and
 * literally rendered the developer-facing sentence "Placeholder pricing — wire up your billing
 * provider of choice." to real visitors.
 *
 * There is no billing system in this product. This test doesn't assert a specific replacement
 * copy (that would make the test brittle for legitimate future wording tweaks) — it asserts the
 * INVARIANT that actually matters: no landing component may claim a dollar-denominated price
 * (since no billing exists to fulfill it) or contain obvious developer/placeholder language
 * meant for the next engineer, not a real visitor.
 *
 * Run with: node --test src/components/landing/__tests__/pricing-claims.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = path.join(__dirname, "..");

function landingFiles(): string[] {
  return readdirSync(LANDING_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(LANDING_DIR, f));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("no landing component's rendered copy contains developer-facing placeholder language", () => {
  const files = landingFiles();
  // Deliberately generic phrasing checks, not just the exact removed sentence — the point is
  // "text written for the next engineer, not a visitor" never reaches production copy again.
  const placeholderPatterns = [/placeholder pricing/i, /wire up your billing/i, /\btodo\b/i, /\bfixme\b/i];
  for (const file of files) {
    const text = stripComments(readFileSync(file, "utf-8"));
    for (const pattern of placeholderPatterns) {
      assert.ok(!pattern.test(text), `${path.basename(file)} contains developer-facing placeholder text (matched ${pattern}) — this must never reach real visitors`);
    }
  }
});

test("no landing component claims a dollar-denominated price — there is no billing system to fulfill one", () => {
  const files = landingFiles();
  const priceClaim = /\$\d/;
  for (const file of files) {
    const text = stripComments(readFileSync(file, "utf-8"));
    assert.ok(!priceClaim.test(text), `${path.basename(file)} claims a dollar price, but no billing system exists in this product`);
  }
});

test("pricing.tsx does not claim unimplemented commercial entitlements (project/duration limits, watermark, team seats, priority rendering)", () => {
  const file = path.join(LANDING_DIR, "pricing.tsx");
  const text = stripComments(readFileSync(file, "utf-8"));
  const fictionalClaims = [/watermark/i, /team seats?/i, /priority rendering/i, /\d+\s*min(ute)?s?\s+video/i, /up to \d+ projects/i];
  for (const pattern of fictionalClaims) {
    assert.ok(!pattern.test(text), `pricing.tsx matched a fictional/unimplemented entitlement claim (${pattern}) — no such limit or feature exists in the product`);
  }
});

test("pricing.tsx's own included-features list only names capabilities that actually exist", () => {
  const file = path.join(LANDING_DIR, "pricing.tsx");
  const text = readFileSync(file, "utf-8");
  // The section must still render something (not be silently empty) and keep its anchor id so
  // the navbar/footer "Pricing" link still resolves to a real section.
  assert.ok(text.includes('id="pricing"'), "the section must keep id=\"pricing\" so nav/footer anchors still work");
  assert.ok(/AI transcription|caption styling|Timeline editing|export/i.test(text), "pricing.tsx should describe real, existing capabilities");
});

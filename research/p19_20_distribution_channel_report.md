# P19.20 — Distribution Channel Investigation

**Task ID:** SUBLY-P19.20-DISTRIBUTION-CHANNEL-154902
**Date:** 2026-09-30

## 1. Distribution channel investigation

Checked every mechanism the task named:

| Mechanism | Checked via | Result |
|---|---|---|
| Existing website hosting | `package.json` `homepage`/`repository` fields | Absent — `{}` |
| GitHub Pages / Releases / Actions | `.github/` directory, `git remote -v` | No `.github/` directory exists; `git remote -v` returns **no remotes at all** — this repository has never been pushed anywhere |
| Vercel | `vercel.json`, `.vercel/` | Neither exists |
| Netlify | `netlify.toml` | Does not exist |
| Cloudflare (Pages/R2/Workers) | `wrangler.toml`, env vars | Does not exist; no `CLOUDFLARE_*`/`R2_*` env vars |
| Object storage (S3 or equivalent) | `.env`'s `STORAGE_DRIVER`, `src/lib/storage/s3.ts` | `STORAGE_DRIVER="local"` — the **active** storage backend is the local filesystem, not S3. `src/lib/storage/s3.ts` exists as alternative application code but has zero configured credentials (`.env` has no `AWS_*`/`S3_*`/bucket variables at all), and even if it were active, it's the backend for **user-uploaded project videos** inside the app — an entirely different purpose from hosting a public installer download. |
| Any other configured host/CDN/domain | Full repo grep for hosting/CDN keywords | No matches beyond the inactive `s3.ts` above |

**Conclusion: no public distribution channel or hosting mechanism of any kind is currently configured in this repository or environment.** Per the task's explicit instruction, no account was created, nothing was uploaded, and no hosting service was invented. The implementation (upload/verify) portion of this task was stopped here, as instructed.

## 2. Website copy audit

Inspected the existing landing page (`src/components/landing/*.tsx`) specifically for the items the task listed.

| Item | Finding |
|---|---|
| `/register` CTA | **Present throughout**: `navbar.tsx` ("Log in" → `/login`, "Create subtitles" → `/register`), `hero.tsx` ("Create subtitles" → `/register`), `pricing.tsx` ("Start for free" → `/register`), `final-cta.tsx` (→ `/register`). The entire primary call-to-action structure is a SaaS sign-up flow, not a "Download for Windows" flow. |
| SaaS/account language | **Present**: navbar has a persistent "Log in" link; `hero.tsx` includes "No credit card required" — language that implies a billing/checkout flow exists (even a free one), reinforcing the account-based framing. |
| Unsupported pricing | **None found** — `pricing.tsx` was already corrected in P19.12 ("Free during preview... no plan tiers"). One minor inconsistency: `hero.tsx` line 71 says "Free plan available," which reads as "one of several plan tiers" and sits slightly at odds with pricing.tsx's own "no plan tiers" framing. Not false, but a small wording mismatch between two sections of the same page. |
| Unsupported AI claims | **None found** — `features.tsx`'s "AI text tools" description ("Fix punctuation, remove filler words, rephrase, shorten — one click") doesn't claim it works offline; no other AI overclaim found. `hero.tsx`'s "AI-powered captions, styled your way" is generic and accurate (Whisper-based transcription genuinely is AI). |
| "Fully offline" claims | **None found** — no landing component claims full offline operation. |
| Unsupported language claims | **None found** — `features.tsx`'s multi-language line is generated from `lib/language-policy.ts` via `supportedLanguageSummary()` and protected by `language-claims.test.ts`; it cannot drift from the actual supported-language list. |
| "Unlimited" claims | **None found.** |
| Typewriter claims | **None found** — corrected in P19.17 (renamed to "Word Fade" everywhere it appeared). |
| Per-word animation claims | **None found** — corrected in P19.17 (`features.tsx` now says "automatic word-by-word highlighting" instead of "per-word animations"; `how-it-works.tsx` now scopes per-word claims to color/size/highlighting only). |
| Cloud-processing confusion | **One minor item**: `pricing.tsx`'s included-features list says "AI transcription with word-level timestamps." Transcription is genuinely AI-based and genuinely local — this isn't false — but the word "AI" sitting in a bullet list right next to no further qualifier could read, to a skimming visitor, as related to the *separate*, cloud-dependent "AI text tools" described elsewhere on the same page. Worth a wording tweak (e.g., "Local transcription with word-level timestamps") in a future pass, not urgent. |

**Additional structural finding, beyond the specific checklist:** the landing page's entire narrative (`hero.tsx`: "Upload, style, export — no editing experience required," paired with the sign-up-first CTA structure) describes a **browser-based, upload-your-video SaaS product** — not a "download and install a Windows desktop app" product. This is a page-wide framing mismatch, not a handful of isolated wrong sentences. Retargeting it for a desktop-download launch would mean rewriting the hero headline/subhead, the primary CTA across four files (navbar, hero, pricing, final-cta), and likely reworking or removing the login/register flow's prominence — a genuine landing-page redesign, not "a safe landing-page-only adjustment."

## 3. Decision: no website changes made

Per the task's own conditions — "DO NOT modify the website source unless... the change is directly related to the desktop launch" and "Only fix issues if the website is clearly intended to be the actual SUBLY public launch page **and doing so is safe**" — no website source was modified, for two independent reasons:

1. **No real download URL exists yet** (§1). Changing any CTA from `/register` to a download link would mean pointing the site's primary action at a placeholder/dead link — replacing a working (if mismatched) flow with a broken one. The task's own "STOP the implementation portion" instruction, given no distribution channel exists, is read here to also cover this dependent step.
2. **The actual fix is a page-wide reframing**, not a narrow, safe, isolated CTA swap — exactly the scope of change the task asks to be reported rather than silently performed.

## 4. Product/application verification

Confirmed unchanged, both before and after this task:

- `find src scripts electron package.json -newer "release/SUBLY Setup 0.1.20.exe"` → empty (no product-code or config file has a modification time newer than the frozen installer).
- `package.json` version: still `0.1.20`.
- No rebuild was run; `release/SUBLY Setup 0.1.20.exe` is untouched (same size, same SHA-256 as recorded in `research/p19_18_release_distribution_report.md`).

## 5. `[DOWNLOAD LINK]` placeholders

Left exactly as-is in all three files (`docs/marketing/SUBLY-PUBLIC-LAUNCH-COPY.md`, `docs/marketing/SUBLY-DOWNLOAD-PAGE.md`, `docs/marketing/SUBLY-LAUNCH-POST.md`), per the task's explicit instruction not to invent a URL. See `docs/releases/SUBLY-0.1.20-MANUAL-DISTRIBUTION-INSTRUCTIONS.md` for what needs to happen before they can be filled in, and the exact re-verification steps to run once they are.

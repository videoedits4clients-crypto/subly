# SUBLY 0.1.20 — Manual Distribution Instructions

No hosting or distribution channel is currently configured for this project (see `research/p19_20_distribution_channel_report.md` for the full investigation — no git remote, no GitHub/Vercel/Netlify/Cloudflare configuration, no object storage credentials). This document is what's needed to actually put the installer somewhere the public can download it.

## The one file that matters

**`release/SUBLY Setup 0.1.20.exe`** — this exact file, unmodified. Do not substitute a rebuilt copy, even one that looks identical; use this specific file.

- Size: 566,402,175 bytes
- SHA-256: `6ada3a2c2e65b41cc54fb8a55640aa68bb0bb4dabcfb5842352ec0c5f02d1b08`

## Choosing where to host it

Any of these will work; pick whichever you already have access to (this task deliberately did not create an account or pick one for you):

- **GitHub Releases** — if you create a GitHub repository for this project, you can attach `SUBLY Setup 0.1.20.exe` directly to a Release; GitHub serves the file for free with no separate hosting needed.
- **Any static file host / object storage you already use** (a personal website, S3/R2/Cloudflare bucket, Google Drive/Dropbox with a public link, etc.).
- **A dedicated download page** — `docs/marketing/SUBLY-DOWNLOAD-PAGE.md` is ready to publish once you have a place to point its download button at.

## Steps

1. **Upload** `release/SUBLY Setup 0.1.20.exe` to your chosen host, exactly as-is.
2. **Get the public URL** the host gives you for that file.
3. **Download it back** from that public URL to a separate location (confirms the upload actually completed correctly, not just that the host accepted it).
4. **Re-verify the downloaded copy**, in PowerShell:
   ```powershell
   Get-FileHash "path\to\downloaded\SUBLY Setup 0.1.20.exe" -Algorithm SHA256
   ```
   The result must read exactly:
   ```
   6ADA3A2C2E65B41CC54FB8A55640AA68BB0BB4DABCFB5842352EC0C5F02D1B08
   ```
   (case-insensitive match to the value above). Also confirm the downloaded file's size is exactly 566,402,175 bytes.
5. **If either check fails**, do not publish that link — something went wrong in the upload (a truncated transfer, a host that silently re-encodes/re-compresses files, etc.). Re-upload and re-verify.
6. **Once verified**, replace every `[DOWNLOAD LINK]` placeholder in:
   - `docs/marketing/SUBLY-PUBLIC-LAUNCH-COPY.md`
   - `docs/marketing/SUBLY-DOWNLOAD-PAGE.md`
   - `docs/marketing/SUBLY-LAUNCH-POST.md`

   with the real, verified URL from step 4.

None of this was performed as part of this task, since no destination exists yet to upload to — this document is the handoff for whoever sets one up.

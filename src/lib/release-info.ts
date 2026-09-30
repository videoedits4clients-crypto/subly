/**
 * Task 161847 (P19.21) — the SINGLE source of truth for the public SUBLY 0.1.20 download/release
 * URLs and artifact facts, so the landing page's CTAs, download page, and metadata can never
 * silently drift apart the way the old `/register`-everywhere pattern did before this task.
 * Verified against the actual published GitHub release (see
 * research/p19_20_github_release_report.md) — do not edit these values without re-verifying
 * against the live release (size/SHA-256 via `Get-FileHash`, URLs via `gh release view`).
 */
export const SUBLY_VERSION = "0.1.20";
export const SUBLY_INSTALLER_SIZE_BYTES = 566_402_175;
export const SUBLY_INSTALLER_SIZE_LABEL = "~566 MB";
export const SUBLY_SHA256 = "6ada3a2c2e65b41cc54fb8a55640aa68bb0bb4dabcfb5842352ec0c5f02d1b08";
export const SUBLY_REPO_URL = "https://github.com/videoedits4clients-crypto/subly";
export const SUBLY_RELEASE_NOTES_URL = "https://github.com/videoedits4clients-crypto/subly/releases/tag/v0.1.20";
export const SUBLY_DOWNLOAD_URL =
  "https://github.com/videoedits4clients-crypto/subly/releases/download/v0.1.20/SUBLY.Setup.0.1.20.exe";
export const SUBLY_INSTALL_GUIDE_URL = "https://github.com/videoedits4clients-crypto/subly/blob/main/docs/INSTALL-WINDOWS.md";

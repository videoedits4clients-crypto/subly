// Regenerates prisma/template.db — the empty, pre-migrated SQLite file the
// desktop app copies into place on first launch (see electron/main.js
// ensureDatabase). Run this whenever prisma/schema.prisma changes.
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const templatePath = path.join(root, "prisma", "template.db");
fs.rmSync(templatePath, { force: true });

const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "prisma", "build", "index.js"), "db", "push", "--schema=prisma/schema.prisma", "--skip-generate", "--accept-data-loss"],
  { cwd: root, env: { ...process.env, DATABASE_URL: `file:${templatePath}` }, stdio: "inherit" },
);
if (result.status !== 0) {
  console.error("Failed to build prisma/template.db");
  process.exit(1);
}

// Desktop mode has no login screen (see electron/main.js + src/lib/api-auth.ts
// SUBLY_DESKTOP bypass) — every project needs to be owned by SOME User row
// per the existing (unchanged) data model, so the template ships with one
// fixed local account that's never actually authenticated against.
async function seedLocalUser() {
  process.env.DATABASE_URL = `file:${templatePath}`;
  const { PrismaClient } = require(path.join(root, "node_modules", "@prisma", "client"));
  const prisma = new PrismaClient();
  await prisma.user.upsert({
    where: { id: "local-user" },
    update: {},
    create: { id: "local-user", email: "local@subly.desktop", name: "You" },
  });
  await prisma.$disconnect();
}

seedLocalUser()
  .then(() => console.log(`[db:template] wrote ${templatePath} (with local-user seeded)`))
  .catch((err) => {
    console.error("Failed to seed local user into template.db", err);
    process.exit(1);
  });

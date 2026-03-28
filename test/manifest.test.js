const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("teams manifest template uses current app name and excludes deprecated packageName", () => {
  const manifestPath = path.resolve(process.cwd(), "teamsapp", "manifest.template.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
  );
  const commands = manifest.bots[0].commandLists[0].commands.map((command) => command.title);

  assert.equal(manifest.name.short, "Marketplace Learn Monitor");
  assert.equal(manifest.name.full, "Marketplace Learn Monitor");
  assert.equal(manifest.version, "{{APP_VERSION}}");
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.ok(commands.includes("history last 7 days"));
  assert.ok(commands.includes("show diff"));
  assert.ok(commands.includes("status"));
  assert.ok(commands.includes("legend"));
  assert.ok(commands.includes("scan now"));
  assert.ok(commands.includes("backfill last 30 days"));
  assert.ok(!commands.includes("partner impact"), "partner impact should not be in manifest");
  assert.ok(!commands.includes("customer impact"), "customer impact should not be in manifest");
  const scanDesc = manifest.bots[0].commandLists[0].commands.find((c) => c.title === "scan now").description;
  assert.ok(scanDesc.includes("[Admin]"), "scan now should be labeled as Admin");
  const backfillDesc = manifest.bots[0].commandLists[0].commands.find((c) => c.title === "backfill last 30 days").description;
  assert.ok(backfillDesc.includes("[Admin]"), "backfill should be labeled as Admin");
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "packageName"), false);
});

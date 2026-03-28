const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);

test("health handler returns versioned status payload", async () => {
  const { createHealthHandler } = require("../dist/src/functions/health.js");
  const { getVersioningScheme, isSemVer } = require("../dist/src/version.js");

  const handler = createHealthHandler({
    docsService: {
      async getStatus() {
        return {
          trackedCount: 3,
          lastDigestAt: "2026-03-19T21:00:00Z",
        };
      },
    },
    repository: {
      async listConversations() {
        return [{ id: "one" }, { id: "two" }];
      },
    },
    botConfigured: true,
    version: packageJson.version,
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.ok, true);
  assert.equal(response.jsonBody.version, packageJson.version);
  assert.equal(response.jsonBody.versionScheme, getVersioningScheme());
  assert.equal(isSemVer(response.jsonBody.version), true);
  assert.equal(response.jsonBody.trackedPages, 3);
  assert.equal(response.jsonBody.registeredConversations, 2);
  assert.equal(response.jsonBody.lastDigestAt, "2026-03-19T21:00:00Z");
});


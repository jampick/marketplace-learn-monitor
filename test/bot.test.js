const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TestAdapter } = require("botbuilder");

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);

function createMockServices(overrides = {}) {
  return {
    docsService: {
      async getStatus() {
        return { trackedCount: 7, lastDigestAt: "2026-03-19T21:10:00Z" };
      },
      async scanNow() {
        return { checkedAt: "2026-03-24T12:00:00Z", trackedUrls: [], changes: [], summary: "" };
      },
      async getTrackedSourceUrls() {
        return ["https://learn.microsoft.com/en-us/partner-center/marketplace-offers/"];
      },
      async getRecentDigests() {
        return [];
      },
      async getChangeHistory() {
        return { since: "", until: "", matchedUrls: [], changes: [] };
      },
      async getLastObservedDiff() {
        return undefined;
      },
      async backfillHistory() {
        return { since: "", until: "", scannedUrls: 0, createdDigests: 0, createdChanges: 0, skippedCount: 0 };
      },
      ...overrides.docsService,
    },
    repository: {
      async listConversations() {
        return [];
      },
      async saveConversation() {},
      ...overrides.repository,
    },
  };
}

function createBot(overrides = {}) {
  const { MarketplaceMonitorBot } = require("../dist/src/bot/marketplaceMonitorBot.js");
  const { docsService, repository } = createMockServices(overrides);
  return new MarketplaceMonitorBot(docsService, repository);
}

test("bot help text includes the current Teams mention name", async () => {
  const { HELP_MESSAGE } = require("../dist/src/bot/marketplaceMonitorBot.js");
  assert.match(HELP_MESSAGE, /@Marketplace Learn Monitor/);
});

test("bot status response includes the live version and counts", async () => {
  const bot = createBot();
  const response = await bot.getResponse("status");

  assert.match(response.text, new RegExp(`Version: ${packageJson.version.replaceAll(".", "\\.")}`));
  assert.match(response.text, /Tracked pages: 7/);
  assert.match(response.text, /Last stored digest: 2026-03-19T21:10:00Z/);
});

test("bot replies on the active turn for a default status prompt", async () => {
  const savedConversations = [];
  const bot = createBot({
    repository: {
      async saveConversation(registration) {
        savedConversations.push(registration);
      },
    },
  });

  const adapter = new TestAdapter(async (turnContext) => {
    await bot.run(turnContext);
  });

  await adapter.send("status").assertReply((activity) => {
    assert.match(activity.text, /^Version: /);
    assert.match(activity.text, /Tracked pages: 7/);
    assert.match(activity.text, /Last stored digest: 2026-03-19T21:10:00Z/);
  });

  assert.equal(savedConversations.length, 1);
  assert.ok(savedConversations[0].conversationId);
  assert.ok(savedConversations[0].conversationReference);
});

test("bot still responds when captureConversation fails", async () => {
  const bot = createBot({
    repository: {
      async listConversations() {
        throw new Error("StorageServiceError: container not found");
      },
      async saveConversation() {
        throw new Error("StorageServiceError: container not found");
      },
    },
  });

  const adapter = new TestAdapter(async (turnContext) => {
    await bot.run(turnContext);
  });

  await adapter.send("status").assertReply((activity) => {
    assert.match(activity.text, /^Version: /);
    assert.match(activity.text, /Tracked pages: 7/);
  });
});

test("bot returns error message when getResponse throws", async () => {
  const bot = createBot({
    docsService: {
      async getStatus() {
        throw new Error("ServiceError: blob read failed");
      },
    },
  });

  const adapter = new TestAdapter(async (turnContext) => {
    await bot.run(turnContext);
  });

  await adapter.send("status").assertReply((activity) => {
    assert.match(activity.text, /Something went wrong/);
  });
});

test("bot responds to all default prompt commands", async () => {
  const bot = createBot();

  const commands = [
    { input: "help", pattern: /Try one of these commands/ },
    { input: "", pattern: /Try one of these commands/ },
    { input: "status", pattern: /Version:/ },
    { input: "what changed today", pattern: /No recent Marketplace documentation changes/ },
    { input: "partner impact", pattern: /No recent partner impact changes/ },
    { input: "customer impact", pattern: /No recent customer impact changes/ },
    { input: "sources", pattern: /Currently tracking 1 Marketplace-related/ },
    { input: "history last 30 days", pattern: /History across tracked docs/ },
    { input: "show diff for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/", pattern: /No observed old\/new diff/ },
    { input: "something random", pattern: /Try one of these commands/ },
  ];

  for (const { input, pattern } of commands) {
    const response = await bot.getResponse(input);
    assert.match(
      response.text,
      pattern,
      `Command "${input}" should match ${pattern} but got: ${response.text.slice(0, 80)}`,
    );
    assert.ok(response.text.length > 0, `Command "${input}" returned empty string`);
  }
});

test("bot returns Adaptive Cards for rich responses", async () => {
  const bot = createBot({
    docsService: {
      async getStatus() {
        return { trackedCount: 7, lastDigestAt: "2026-03-19T21:10:00Z" };
      },
      async scanNow() {
        return {
          checkedAt: "2026-03-24T12:00:00Z",
          trackedUrls: ["https://learn.microsoft.com/en-us/partner-center/marketplace-offers/"],
          changes: [{
            id: "c1",
            docId: "offers",
            title: "Marketplace offers | Microsoft Learn",
            canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
            severity: "major",
            audience: "partner",
            categories: ["publishing"],
            summary: "Updated offer steps.",
            whyItMatters: "Changes how offers are created.",
            highlights: [{ type: "added", text: "New section on private offers" }],
            detectedAt: "2026-03-24T12:00:00Z",
          }],
          summary: "1 change",
          documentIndex: {},
        };
      },
      async getRecentDigests() {
        return [];
      },
      async getChangeHistory() {
        return { since: "", until: "", matchedUrls: [], changes: [] };
      },
      async getLastObservedDiff() {
        return undefined;
      },
      async backfillHistory() {
        return { since: "", until: "", scannedUrls: 0, createdDigests: 0, createdChanges: 0, skippedCount: 0 };
      },
    },
  });

  // Commands that should produce cards
  const cardCommands = ["scan now", "history last 30 days",
    "show diff for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/"];

  for (const input of cardCommands) {
    const response = await bot.getResponse(input);
    assert.ok(response.card, `Command "${input}" should return an Adaptive Card`);
    assert.equal(response.card.type, "AdaptiveCard", `Card for "${input}" should have type AdaptiveCard`);
    assert.ok(Array.isArray(response.card.body), `Card for "${input}" should have a body array`);
  }

  // Commands that should NOT produce cards (text-only)
  const textOnlyCommands = ["help", "status", "sources"];
  for (const input of textOnlyCommands) {
    const response = await bot.getResponse(input);
    assert.equal(response.card, undefined, `Command "${input}" should not return a card`);
    assert.ok(response.text.length > 0, `Command "${input}" should return text`);
  }
});

test("scan card includes Show Diff actions with messageBack for each change", async () => {
  const bot = createBot({
    docsService: {
      async getStatus() {
        return { trackedCount: 7, lastDigestAt: "2026-03-19T21:10:00Z" };
      },
      async scanNow() {
        return {
          checkedAt: "2026-03-24T12:00:00Z",
          trackedUrls: ["https://learn.microsoft.com/en-us/partner-center/marketplace-offers/"],
          changes: [{
            id: "c1",
            docId: "offers",
            title: "Marketplace offers | Microsoft Learn",
            canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
            severity: "major",
            audience: "partner",
            categories: ["publishing"],
            summary: "Updated offer steps.",
            whyItMatters: "Changes how offers are created.",
            highlights: [{ type: "added", text: "New section on private offers" }],
            detectedAt: "2026-03-24T12:00:00Z",
          }],
          summary: "1 change",
          documentIndex: {},
        };
      },
    },
  });

  const response = await bot.getResponse("scan now");
  assert.ok(response.card, "Scan card should exist");
  assert.ok(Array.isArray(response.card.actions), "Card should have actions array");

  const showDiffAction = response.card.actions.find((a) => a.title === "Show Diff");
  assert.ok(showDiffAction, "Card should have a Show Diff action");
  assert.equal(showDiffAction.type, "Action.Submit");
  assert.equal(showDiffAction.data.msteams.type, "messageBack");
  assert.match(
    showDiffAction.data.msteams.text,
    /show diff for https:\/\/learn\.microsoft\.com/,
    "Show Diff action should contain the page URL",
  );
});


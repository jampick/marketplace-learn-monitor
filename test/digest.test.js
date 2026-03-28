const test = require("node:test");
const assert = require("node:assert/strict");

const { planDigestDelivery } = require("../dist/src/functions/dailyDigest.js");

function makeScanResult(changeCount) {
  return {
    checkedAt: "2026-03-28T14:00:00Z",
    trackedUrls: [],
    changes: Array.from({ length: changeCount }, (_, i) => ({
      id: `c${i}`,
      docId: `doc${i}`,
      title: `Page ${i}`,
      canonicalUrl: `https://learn.microsoft.com/en-us/partner-center/page-${i}`,
      severity: "minor",
      audience: "partner",
      categories: ["publishing"],
      summary: `Change ${i}`,
      whyItMatters: "Test change",
      highlights: [],
      detectedAt: "2026-03-28T14:00:00Z",
    })),
    summary: `${changeCount} changes`,
    documentIndex: {},
  };
}

function makeConversation(id, lastDigestAt) {
  return {
    id,
    scope: "personal",
    conversationReference: {},
    addedAt: "2026-03-01T00:00:00Z",
    lastSeenAt: "2026-03-28T00:00:00Z",
    lastDigestAt,
  };
}

const defaultConfig = {
  sendEmptyDigests: false,
  maxChangesPerDigest: 15,
  digestCooldownHours: 6,
  botAppId: "test-bot-id",
};

test("planDigestDelivery skips when no changes and sendEmptyDigests is false", () => {
  const plan = planDigestDelivery(makeScanResult(0), [makeConversation("c1")], defaultConfig);
  assert.equal(plan.action, "skip-empty");
});

test("planDigestDelivery sends when no changes but sendEmptyDigests is true", () => {
  const plan = planDigestDelivery(
    makeScanResult(0),
    [makeConversation("c1")],
    { ...defaultConfig, sendEmptyDigests: true },
  );
  assert.equal(plan.action, "send");
});

test("planDigestDelivery triggers circuit breaker when changes exceed limit", () => {
  const plan = planDigestDelivery(makeScanResult(20), [makeConversation("c1")], defaultConfig);
  assert.equal(plan.action, "skip-circuit-breaker");
});

test("planDigestDelivery sends when changes are within limit", () => {
  const plan = planDigestDelivery(makeScanResult(5), [makeConversation("c1")], defaultConfig);
  assert.equal(plan.action, "send");
  assert.equal(plan.conversations.length, 1);
  assert.equal(plan.conversations[0].deliver, true);
});

test("planDigestDelivery sends at exactly the limit", () => {
  const plan = planDigestDelivery(makeScanResult(15), [makeConversation("c1")], defaultConfig);
  assert.equal(plan.action, "send");
});

test("planDigestDelivery skips conversation within cooldown window", () => {
  const now = new Date("2026-03-28T14:00:00Z").getTime();
  const recentDigest = "2026-03-28T12:00:00Z"; // 2 hours ago, within 6hr cooldown
  const plan = planDigestDelivery(
    makeScanResult(3),
    [makeConversation("c1", recentDigest)],
    defaultConfig,
    now,
  );
  assert.equal(plan.action, "send");
  assert.equal(plan.conversations[0].deliver, false);
  assert.equal(plan.conversations[0].reason, "cooldown");
});

test("planDigestDelivery delivers to conversation past cooldown window", () => {
  const now = new Date("2026-03-28T14:00:00Z").getTime();
  const oldDigest = "2026-03-28T06:00:00Z"; // 8 hours ago, past 6hr cooldown
  const plan = planDigestDelivery(
    makeScanResult(3),
    [makeConversation("c1", oldDigest)],
    defaultConfig,
    now,
  );
  assert.equal(plan.action, "send");
  assert.equal(plan.conversations[0].deliver, true);
});

test("planDigestDelivery handles mix of cooled-down and eligible conversations", () => {
  const now = new Date("2026-03-28T14:00:00Z").getTime();
  const plan = planDigestDelivery(
    makeScanResult(3),
    [
      makeConversation("c1", "2026-03-28T12:00:00Z"), // 2hr ago — cooldown
      makeConversation("c2", "2026-03-27T10:00:00Z"), // 28hr ago — deliver
      makeConversation("c3", undefined),               // never sent — deliver
    ],
    defaultConfig,
    now,
  );
  assert.equal(plan.action, "send");
  assert.equal(plan.conversations[0].deliver, false);
  assert.equal(plan.conversations[1].deliver, true);
  assert.equal(plan.conversations[2].deliver, true);
});

test("planDigestDelivery skips when bot is not configured", () => {
  const plan = planDigestDelivery(
    makeScanResult(3),
    [makeConversation("c1")],
    { ...defaultConfig, botAppId: "" },
  );
  assert.equal(plan.action, "skip-no-bot");
});

test("planDigestDelivery skips when no conversations registered", () => {
  const plan = planDigestDelivery(makeScanResult(3), [], defaultConfig);
  assert.equal(plan.action, "skip-no-conversations");
});

const test = require("node:test");
const assert = require("node:assert/strict");

// The classifySeverity and buildWhyItMatters methods are private,
// so we test them through buildChangeSummary via the public scanNow flow.
// For unit-level verification we test the exported patterns indirectly
// through the bot's getResponse with test scenarios.

const { MarketplaceDocsService } = require("../dist/src/services/marketplaceDocsService.js");

function createMockRepository(digests = []) {
  return {
    async loadDocumentIndex() { return {}; },
    async saveDocumentIndex() {},
    async loadSnapshot() { return undefined; },
    async saveSnapshot(doc) { return `snapshots/${doc.docId}/latest.json`; },
    async loadDigestHistory() { return digests; },
    async saveDigest() {},
    async listConversations() { return []; },
    createDigestId(seed) { return seed.slice(0, 24); },
  };
}

function createMockConfig() {
  return {
    marketplaceLandingUrl: "https://example.com/landing",
    partnerCenterTocUrl: "https://example.com/toc.json",
    allowedDocPrefixes: ["https://learn.microsoft.com/en-us/partner-center/"],
    digestSchedule: "0 0 14 * * *",
    sendEmptyDigests: false,
    maxAnnouncementPages: 6,
    maxChangesPerDigest: 15,
    digestCooldownHours: 6,
    storageContainer: "test",
    stateDirectory: ".data",
    botAppId: "test",
  };
}

test("severity: retirement content is classified as major even with few lines", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  // Access the private method via the prototype for testing
  const contentAnalysis = {
    highlights: [
      { type: "added", text: "Added or expanded guidance: Retirement of the Qualified Referral Program (QRP)" },
    ],
    meaningfulLineCount: 1,
    hasRemovedContent: false,
    hasChangedHeading: false,
    hasHighSignalKeyword: false,
  };

  // classifySeverity is private, so we use a workaround
  const severity = service.__proto__.classifySeverity.call(service,
    { docId: "test", bodyHash: "old" }, // previous exists
    [],
    contentAnalysis,
  );
  assert.equal(severity, "major", "Retirement content should be major regardless of line count");
});

test("severity: deprecation content is classified as major", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  const contentAnalysis = {
    highlights: [
      { type: "removed", text: "Removed or replaced guidance: This API version is deprecated and will be removed" },
    ],
    meaningfulLineCount: 1,
    hasRemovedContent: true,
    hasChangedHeading: false,
    hasHighSignalKeyword: false,
  };

  const severity = service.__proto__.classifySeverity.call(service,
    { docId: "test", bodyHash: "old" },
    [],
    contentAnalysis,
  );
  assert.equal(severity, "major", "Deprecation content should be major");
});

test("severity: preview/optional content stays minor", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  const contentAnalysis = {
    highlights: [
      { type: "added", text: "Added or expanded guidance: This optional preview feature is now available" },
    ],
    meaningfulLineCount: 1,
    hasRemovedContent: false,
    hasChangedHeading: false,
    hasHighSignalKeyword: false,
  };

  const severity = service.__proto__.classifySeverity.call(service,
    { docId: "test", bodyHash: "old" },
    [],
    contentAnalysis,
  );
  assert.equal(severity, "minor", "Preview/optional content should be minor");
});

test("severity: metadata-only change is cosmetic", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  const contentAnalysis = {
    highlights: [],
    meaningfulLineCount: 0,
    hasRemovedContent: false,
    hasChangedHeading: false,
    hasHighSignalKeyword: false,
  };

  const severity = service.__proto__.classifySeverity.call(service,
    { docId: "test", bodyHash: "old" },
    [{ type: "meta", text: "Commit changed" }],
    contentAnalysis,
  );
  assert.equal(severity, "cosmetic", "Metadata-only changes should be cosmetic");
});

test("impact: retirement scenario produces specific impact statement", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  const impact = service.__proto__.buildWhyItMatters.call(service,
    "partner",
    ["publishing"],
    { title: "March 2026 announcements", canonicalUrl: "https://example.com" },
    "major",
    [{ type: "added", text: "Added or expanded guidance: Retirement of the Qualified Referral Program (QRP)" }],
  );
  assert.match(impact, /retirement/i, "Should mention retirement");
  assert.match(impact, /QRP/i, "Should mention the specific program");
  assert.match(impact, /Partners/i, "Should address partners");
});

test("impact: pricing change produces pricing-specific statement", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  const impact = service.__proto__.buildWhyItMatters.call(service,
    "partner",
    ["pricing"],
    { title: "Pricing", canonicalUrl: "https://example.com" },
    "major",
    [{ type: "added", text: "Added or expanded guidance: New pricing model for SaaS offers" }],
  );
  assert.match(impact, /pricing/i, "Should mention pricing");
  assert.match(impact, /Partners/i, "Should address partners");
});

test("impact: cosmetic severity returns no-operational-impact statement", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  const impact = service.__proto__.buildWhyItMatters.call(service,
    "partner",
    ["other"],
    { title: "Test", canonicalUrl: "https://example.com" },
    "cosmetic",
    [],
  );
  assert.match(impact, /no likely operational impact/i);
});

test("impact: deadline content produces deadline-specific statement", async () => {
  const service = new MarketplaceDocsService(createMockRepository(), createMockConfig());

  const impact = service.__proto__.buildWhyItMatters.call(service,
    "both",
    ["publishing"],
    { title: "Updates", canonicalUrl: "https://example.com" },
    "major",
    [{ type: "added", text: "Added or expanded guidance: Effective date June 30, 2026 for new listing requirements" }],
  );
  assert.match(impact, /deadline/i, "Should mention deadline");
  assert.match(impact, /Partners and customers/i, "Should address both audiences");
});

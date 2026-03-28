const test = require("node:test");
const assert = require("node:assert/strict");

test("history query parser handles URL, audience, and relative windows", async () => {
  const { parseHistoryQuery } = require("../dist/src/bot/historyQuery.js");

  const result = parseHistoryQuery(
    "partner history for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/?view=partnercenter-ps last 14 days",
    new Date("2026-03-19T12:00:00.000Z"),
  );

  assert.equal(result.audience, "partner");
  assert.equal(
    result.url,
    "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
  );
  assert.equal(result.since, "2026-03-05T12:00:00.000Z");
  assert.equal(result.until, "2026-03-19T12:00:00.000Z");
});

test("history service filters by date, URL, and audience", async () => {
  const { MarketplaceDocsService } = require("../dist/src/services/marketplaceDocsService.js");
  const {
    formatBackfillResult,
    formatChangeHistory,
    formatObservedDiff,
  } = require("../dist/src/services/digestFormatter.js");

  const service = new MarketplaceDocsService(
    {
      async loadDigestHistory() {
        return [
          {
            id: "digest-1",
            createdAt: "2026-03-18T10:00:00.000Z",
            summary: "digest 1",
            changes: [
              {
                id: "change-1",
                docId: "offers",
                title: "Marketplace offers",
                canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
                severity: "major",
                audience: "partner",
                categories: ["publishing", "pricing"],
                summary: "Updated offer publishing steps.",
                whyItMatters:
                  "This matters to Marketplace publishers and partner operations teams because it may change how offers are created, configured, or submitted on Marketplace offers.",
                highlights: [],
                detectedAt: "2026-03-18T10:00:00.000Z",
              },
              {
                id: "change-2",
                docId: "billing",
                title: "Marketplace billing",
                canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/billing/",
                severity: "minor",
                audience: "customer",
                categories: ["billing"],
                summary: "Updated buyer billing guidance.",
                whyItMatters:
                  "This matters to customers or buyer-side stakeholders because it may affect payout, invoicing, tax, or billing operations on Marketplace billing.",
                highlights: [],
                detectedAt: "2026-03-18T10:00:00.000Z",
              },
            ],
          },
          {
            id: "digest-2",
            createdAt: "2026-02-10T10:00:00.000Z",
            summary: "digest 2",
            changes: [
              {
                id: "change-3",
                docId: "offers-old",
                title: "Marketplace offers",
                canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
                severity: "minor",
                audience: "both",
                categories: ["apis"],
                summary: "Older automation guidance update.",
                whyItMatters:
                  "This matters to both Marketplace publishers and customers because it may affect automation, integrations, or API-driven publishing workflows on Marketplace offers.",
                highlights: [],
                detectedAt: "2026-02-10T10:00:00.000Z",
              },
            ],
          },
        ];
      },
    },
    {},
  );

  const result = await service.getChangeHistory({
    url: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/?tabs=current",
    audience: "partner",
    since: "2026-03-01T00:00:00.000Z",
    until: "2026-03-31T23:59:59.999Z",
  });

  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.matchedUrls, [
    "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
  ]);
  assert.equal(result.changes[0].id, "change-1");

  const formatted = formatChangeHistory(result);
  assert.match(formatted, /History for requested URL/);
  assert.match(formatted, /Window: 2026-03-01 to 2026-03-31/);
  assert.match(formatted, /1 change\(s\) across 1 document\(s\)\./);
  assert.match(formatted, /Severity: 1 major\./);
  assert.match(formatted, /Marketplace offers/);
  assert.match(formatted, /Updated offer publishing steps\./);
  assert.match(formatted, /2026-03-18/);

  const savedDigests = [];
  const backfillService = new MarketplaceDocsService(
    {
      async loadDigestHistory() {
        return [];
      },
      async saveDigest(digest) {
        savedDigests.push(digest);
      },
      createDigestId(seed) {
        return `digest-${seed.length}`;
      },
    },
    {},
  );

  backfillService.resolveTrackedUrls = async () => [
    "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
    "https://learn.microsoft.com/en-us/partner-center/billing/",
  ];
  backfillService.fetchDocument = async (url) => {
    if (url.includes("marketplace-offers")) {
      return {
        docId: "offers",
        url,
        canonicalUrl: url,
        title: "Marketplace offers",
        summary: "Manage offers, private offers, and commercial publishing workflows.",
        sourcePath: "partner-center/marketplace-offers.md",
        gitCommitId: "abc123",
        updatedAt: "2026-03-10",
        fetchedAt: "2026-03-19T12:00:00.000Z",
        bodyHash: "hash-1",
        body: "",
        headings: ["Create an offer", "Private offers"],
      };
    }

    return {
      docId: "billing",
      url,
      canonicalUrl: url,
      title: "Marketplace billing",
      summary: "Review billing guidance for customers.",
      sourcePath: "partner-center/billing.md",
      gitCommitId: "def456",
      updatedAt: "2026-01-10",
      fetchedAt: "2026-03-19T12:00:00.000Z",
      bodyHash: "hash-2",
      body: "",
      headings: ["Invoices"],
    };
  };

  const backfillResult = await backfillService.backfillHistory({
    since: "2026-03-01T00:00:00.000Z",
    until: "2026-03-31T23:59:59.999Z",
  });

  assert.equal(backfillResult.createdChanges, 1);
  assert.equal(backfillResult.createdDigests, 1);
  assert.equal(backfillResult.scannedUrls, 2);
  assert.equal(savedDigests.length, 1);
  assert.equal(savedDigests[0].changes[0].backfilled, true);

  const backfillMessage = formatBackfillResult(backfillResult);
  assert.match(backfillMessage, /Backfilled inferred history/);
  assert.match(backfillMessage, /Created 1 inferred change\(s\)/);

  const diffService = new MarketplaceDocsService(
    {
      async loadDigestHistory() {
        return [
          {
            id: "digest-1",
            createdAt: "2026-03-18T10:00:00.000Z",
            summary: "digest 1",
            changes: [
              {
                id: "change-1",
                docId: "offers",
                title: "Marketplace offers",
                canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
                severity: "major",
                audience: "partner",
                categories: ["publishing"],
                summary: "Updated offer publishing steps.",
                whyItMatters:
                  "This matters to Marketplace publishers and partner operations teams because it may change how offers are created, configured, or submitted on Marketplace offers.",
                highlights: [],
                detectedAt: "2026-03-18T10:00:00.000Z",
              },
            ],
          },
        ];
      },
      async listSnapshots() {
        return [
          {
            docId: "offers",
            url: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
            canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
            title: "Marketplace offers",
            fetchedAt: "2026-03-10T10:00:00.000Z",
            bodyHash: "old",
            body: "Old paragraph about private offers.\n",
            headings: [],
          },
          {
            docId: "offers",
            url: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
            canonicalUrl: "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
            title: "Marketplace offers",
            fetchedAt: "2026-03-18T10:00:00.000Z",
            bodyHash: "new",
            body: "New paragraph about private offers and approvals.\n",
            headings: [],
          },
        ];
      },
    },
    {},
  );

  const observedDiff = await diffService.getLastObservedDiff(
    "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
  );

  assert.equal(observedDiff.change.id, "change-1");
  assert.equal(observedDiff.excerpts.length, 1);
  const observedDiffMessage = formatObservedDiff(
    observedDiff,
    "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
  );
  assert.match(observedDiffMessage, /Latest observed diff/);
  assert.match(observedDiffMessage, /Severity: MAJOR/);
  assert.match(observedDiffMessage, /Old: Old paragraph about private offers\./);
  assert.match(observedDiffMessage, /New: New paragraph about private offers and approvals\./);
});

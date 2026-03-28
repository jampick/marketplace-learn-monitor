import type { ScanResult, ChangeSummary } from "../models";
import { buildDigestSummary } from "../services/digestFormatter";

const TEST_CHANGE: ChangeSummary = {
  id: "test-qrp-retirement-fixture",
  docId: "partner-center-announcements-2026-march",
  title: "March 2026 announcements - Partner Center announcements",
  canonicalUrl:
    "https://learn.microsoft.com/en-us/partner-center/announcements/2026-march",
  sourcePath: "partner-center/announcements/2026-march.md",
  updatedAt: "2026-03-27T16:03:00.000Z",
  gitCommitId: "262f5bd728c4",
  audience: "partner",
  severity: "major",
  categories: ["publishing"],
  summary: "Added: Retirement of the Qualified Referral Program (QRP)",
  whyItMatters:
    "Partners should review new guidance on Retirement of the Qualified Referral Program (QRP).",
  highlights: [
    {
      type: "meta",
      text: "The page's published update timestamp changed to 2026-03-27T16:03:00.000Z.",
    },
    {
      type: "meta",
      text: "The backing Learn source commit changed to 262f5bd728c4.",
    },
    {
      type: "added",
      text: "Added or expanded guidance: Retirement of the Qualified Referral Program (QRP)",
    },
  ],
  detectedAt: new Date().toISOString(),
};

export function buildTestScanResult(): ScanResult {
  const changes = [{ ...TEST_CHANGE, detectedAt: new Date().toISOString() }];

  return {
    checkedAt: new Date().toISOString(),
    trackedUrls: [
      "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/",
      "https://learn.microsoft.com/en-us/partner-center/announcements/2026-march",
    ],
    changes,
    summary: buildDigestSummary(changes, new Date().toISOString()),
    documentIndex: {},
  };
}

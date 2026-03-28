import type {
  BackfillResult,
  ChangeCategory,
  ChangeHistoryResult,
  ChangeSeverity,
  ChangeSummary,
  DigestHistoryItem,
  ImpactAudience,
  ObservedDiffResult,
  ScanResult,
} from "../models";

const CATEGORY_ACTIVITY_LABELS: Record<ChangeCategory, string> = {
  account: "publisher onboarding, access, and tenant setup",
  publishing: "offer configuration, listing updates, submission, and private offer workflows",
  pricing: "pricing, metering, and commercial packaging decisions",
  billing: "buyer billing, partner payout, invoicing, and tax operations",
  analytics: "Marketplace reporting, order visibility, and usage analysis",
  apis: "API-driven publishing, fulfillment, and automation flows",
  support: "support, troubleshooting, and issue escalation paths",
  announcements: "release readiness, policy rollout, and program communications",
  other: "general Marketplace execution work",
};

function getEffectiveSeverity(change: ChangeSummary): ChangeSeverity {
  if (change.severity === "major" || change.severity === "minor" || change.severity === "cosmetic") {
    return change.severity;
  }

  const text = [change.summary, change.whyItMatters, ...change.highlights.map((highlight) => highlight.text)]
    .join(" ")
    .toLowerCase();

  if (
    text.includes("backing learn source commit changed") ||
    text.includes("published update timestamp changed") ||
    text.includes("page title changed")
  ) {
    return "cosmetic";
  }

  if (
    text.includes("added") ||
    text.includes("removed") ||
    text.includes("private offer") ||
    text.includes("pricing") ||
    text.includes("billing") ||
    text.includes("tax")
  ) {
    return "major";
  }

  return "minor";
}

function shortenSingleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatCompactTitle(title: string): string {
  return title.replace(/\s+\|\s+Microsoft Learn$/i, "").trim();
}

function formatCompactSummary(change: ChangeSummary): string {
  const summary = change.summary ?? "";

  if (/backing learn source commit changed/i.test(summary)) {
    return "Source commit updated.";
  }

  if (/published update timestamp changed/i.test(summary)) {
    return "Published update date changed.";
  }

  if (/page title changed/i.test(summary)) {
    return "Page title changed.";
  }

  if (/^backfilled update on/i.test(summary)) {
    return summary.replace(/; exact diff unavailable\.?$/i, ".");
  }

  return shortenSingleLine(summary.replace(/^Updated [^:]+:\s*/i, ""), 96);
}

function formatChangeLine(change: ChangeSummary, includeDetectedAt = false): string {
  const header = [
    `[${formatSeverityLabel(getEffectiveSeverity(change))}]`,
    `[${change.audience.toUpperCase()}]`,
    change.backfilled ? "[BACKFILLED]" : undefined,
    includeDetectedAt ? `[${formatDateLabel(change.detectedAt)}]` : undefined,
    change.title,
  ]
    .filter(Boolean)
    .join(" ");

  return `- ${header}\n  Changed: ${change.summary}\n  Impact: ${change.whyItMatters}\n  ${change.canonicalUrl}`;
}

function formatDateLabel(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString().slice(0, 10);
}

function buildHistoryContextSummary(changes: ChangeSummary[]): string {
  const audienceCounts = {
    partner: changes.filter((change) => change.audience === "partner").length,
    customer: changes.filter((change) => change.audience === "customer").length,
    both: changes.filter((change) => change.audience === "both").length,
  };

  const rankedCategories = Object.entries(
    changes.flatMap((change) => change.categories).reduce<Record<string, number>>((counts, category) => {
      counts[category] = (counts[category] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category]) => CATEGORY_ACTIVITY_LABELS[category as ChangeCategory]);

  const activitySummary =
    rankedCategories.length > 0
      ? rankedCategories.join("; ")
      : CATEGORY_ACTIVITY_LABELS.other;
  const severityCounts = {
    major: changes.filter((change) => getEffectiveSeverity(change) === "major").length,
    minor: changes.filter((change) => getEffectiveSeverity(change) === "minor").length,
    cosmetic: changes.filter((change) => getEffectiveSeverity(change) === "cosmetic").length,
  };

  return [
    `Marketplace activity context: the strongest signals point to ${activitySummary}.`,
    `Impact mix: ${audienceCounts.partner} partner-focused, ${audienceCounts.customer} customer-focused, ${audienceCounts.both} shared.`,
    `Severity mix: ${severityCounts.major} major, ${severityCounts.minor} minor, ${severityCounts.cosmetic} cosmetic.`,
  ].join(" ");
}

function buildHistorySeveritySummary(changes: ChangeSummary[]): string {
  const severityCounts = {
    major: changes.filter((change) => getEffectiveSeverity(change) === "major").length,
    minor: changes.filter((change) => getEffectiveSeverity(change) === "minor").length,
    cosmetic: changes.filter((change) => getEffectiveSeverity(change) === "cosmetic").length,
  };

  if (severityCounts.major === 0 && severityCounts.minor === 0) {
    return "Severity: cosmetic only.";
  }

  const parts = [
    severityCounts.major > 0 ? `${severityCounts.major} major` : undefined,
    severityCounts.minor > 0 ? `${severityCounts.minor} minor` : undefined,
    severityCounts.cosmetic > 0 ? `${severityCounts.cosmetic} cosmetic` : undefined,
  ].filter(Boolean);

  return `Severity: ${parts.join(", ")}.`;
}

function buildHistoryTopDocsSummary(changes: ChangeSummary[]): string | undefined {
  const titles = [...new Set(changes.map((change) => formatCompactTitle(change.title)))]
    .slice(0, 2)
    .map((title) => shortenSingleLine(title, 40));

  if (titles.length === 0) {
    return undefined;
  }

  return `Top docs: ${titles.join("; ")}.`;
}

function formatSeverityLabel(severity: ChangeSeverity): string {
  switch (severity) {
    case "major":
      return "MAJOR";
    case "minor":
      return "MINOR";
    default:
      return "COSMETIC";
  }
}

function getSeverityRank(severity: ChangeSeverity): number {
  switch (severity) {
    case "major":
      return 0;
    case "minor":
      return 1;
    default:
      return 2;
  }
}

function sortChangesForDisplay(changes: ChangeSummary[]): ChangeSummary[] {
  return [...changes].sort((left, right) => {
    const severityDelta =
      getSeverityRank(getEffectiveSeverity(left)) - getSeverityRank(getEffectiveSeverity(right));
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.detectedAt.localeCompare(left.detectedAt);
  });
}

export function formatScanDigest(scanResult: ScanResult): string {
  if (scanResult.changes.length === 0) {
    return `Marketplace doc monitor checked ${scanResult.trackedUrls.length} pages at ${scanResult.checkedAt} and found no new changes.`;
  }

  const lines = [buildDigestSummary(scanResult.changes, formatDateLabel(scanResult.checkedAt))];

  const sortedChanges = sortChangesForDisplay(scanResult.changes);

  for (const change of sortedChanges) {
    lines.push(formatChangeLine(change));
  }

  return lines.join("\n\n");
}

export function formatDigestHistory(
  digests: DigestHistoryItem[],
  audience?: ImpactAudience,
): string {
  const filteredChanges = digests.flatMap((digest) =>
    digest.changes.filter((change) => !audience || change.audience === audience || change.audience === "both"),
  );

  if (filteredChanges.length === 0) {
    return audience
      ? `No recent ${audience} impact changes are stored yet.`
      : "No recent Marketplace documentation changes are stored yet.";
  }

  return sortChangesForDisplay(filteredChanges)
    .map((change) => formatChangeLine(change))
    .join("\n\n");
}

export function formatChangeHistory(result: ChangeHistoryResult): string {
  const header = result.url
    ? "History for requested URL"
    : "History across tracked docs";
  const audienceLabel = result.audience ? ` (${result.audience})` : "";
  const windowLabel = `${formatDateLabel(result.since)} to ${formatDateLabel(result.until)}`;

  if (result.changes.length === 0) {
    return [
      `${header}${audienceLabel}`,
      `Window: ${windowLabel}`,
      "No stored Marketplace changes matched that scope yet.",
    ].join("\n");
  }

  const sortedChanges = sortChangesForDisplay(result.changes);
  const lines = [
    `${header}${audienceLabel}`,
    `Window: ${windowLabel}`,
    `${result.changes.length} change(s) across ${result.matchedUrls.length} document(s).`,
    buildHistorySeveritySummary(result.changes),
    buildHistoryContextSummary(result.changes),
  ];

  for (const change of sortedChanges) {
    lines.push(formatChangeLine(change, true));
  }

  return lines.filter(Boolean).join("\n\n");
}

export function formatBackfillResult(result: BackfillResult): string {
  const header = result.url
    ? `Backfilled inferred history for ${result.url}`
    : "Backfilled inferred history across tracked Marketplace documentation";
  const windowLabel = `Window: ${formatDateLabel(result.since)} to ${formatDateLabel(result.until)}`;

  if (result.createdChanges === 0) {
    return [
      header,
      windowLabel,
      "No in-scope Learn pages had backfillable updates, or those inferred history entries were already stored.",
    ].join("\n");
  }

  return [
    header,
    windowLabel,
    `Created ${result.createdChanges} inferred change(s) across ${result.createdDigests} digest day(s) from ${result.scannedUrls} tracked page(s).`,
    `Skipped ${result.skippedCount} page(s) because they were out of range, lacked usable metadata, or were already backfilled.`,
    "These history entries are marked as backfilled because they come from Learn metadata rather than exact historical diffs.",
  ].join("\n");
}

export function formatObservedDiff(result: ObservedDiffResult | undefined, requestedUrl: string): string {
  if (!result) {
    return [
      `No observed old/new diff is stored yet for ${requestedUrl}.`,
      "Exact old/new text is only available for observed changes after the bot started monitoring.",
    ].join("\n");
  }

  const lines = [
    `Latest observed diff for ${result.canonicalUrl}`,
    `Detected at: ${formatDateLabel(result.change.detectedAt)}`,
    `Severity: ${formatSeverityLabel(result.change.severity)}`,
    `Impact: ${result.change.whyItMatters}`,
    `Changed: ${result.change.summary}`,
  ];

  if (result.excerpts.length === 0) {
    lines.push("No text excerpt could be reconstructed from the stored snapshots.");
    return lines.join("\n\n");
  }

  for (const excerpt of result.excerpts.slice(0, 2)) {
    lines.push(
      [
        `Old: ${excerpt.oldText ?? "[no removed text excerpt captured]"}`,
        `New: ${excerpt.newText ?? "[no added text excerpt captured]"}`,
      ].join("\n"),
    );
  }

  return lines.join("\n\n");
}

export function buildDigestSummary(changes: ChangeSummary[], checkedAt: string): string {
  if (changes.length === 0) {
    return `No Marketplace documentation changes detected at ${checkedAt}.`;
  }

  const severityCounts = {
    major: changes.filter((change) => getEffectiveSeverity(change) === "major").length,
    minor: changes.filter((change) => getEffectiveSeverity(change) === "minor").length,
    cosmetic: changes.filter((change) => getEffectiveSeverity(change) === "cosmetic").length,
  };

  return [
    `${changes.length} Marketplace documentation change(s) detected at ${checkedAt}.`,
    `${severityCounts.major} major, ${severityCounts.minor} minor, ${severityCounts.cosmetic} cosmetic.`,
  ].join(" ");
}


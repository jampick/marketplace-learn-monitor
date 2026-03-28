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

// ── Adaptive Card element helpers ────────────────────────────────────

interface TextBlockOptions {
  weight?: "bolder" | "lighter";
  size?: "small" | "default" | "medium" | "large";
  color?: "default" | "dark" | "light" | "accent" | "good" | "warning" | "attention";
  fontType?: "default" | "monospace";
  wrap?: boolean;
  isSubtle?: boolean;
  separator?: boolean;
  spacing?: "none" | "small" | "default" | "medium" | "large" | "extraLarge" | "padding";
}

function textBlock(text: string, options: TextBlockOptions = {}): object {
  return {
    type: "TextBlock",
    text,
    wrap: options.wrap ?? true,
    ...(options.weight && { weight: options.weight }),
    ...(options.size && { size: options.size }),
    ...(options.color && { color: options.color }),
    ...(options.fontType && { fontType: options.fontType }),
    ...(options.isSubtle !== undefined && { isSubtle: options.isSubtle }),
    ...(options.separator !== undefined && { separator: options.separator }),
    ...(options.spacing && { spacing: options.spacing }),
  };
}

type ContainerStyle = "default" | "emphasis" | "good" | "attention" | "warning" | "accent";

function container(
  items: object[],
  options: { style?: ContainerStyle; separator?: boolean; spacing?: string; bleed?: boolean } = {},
): object {
  return {
    type: "Container",
    items,
    ...(options.style && { style: options.style }),
    ...(options.separator !== undefined && { separator: options.separator }),
    ...(options.spacing && { spacing: options.spacing }),
    ...(options.bleed !== undefined && { bleed: options.bleed }),
  };
}

function columnSet(columns: object[], options: { separator?: boolean; spacing?: string } = {}): object {
  return {
    type: "ColumnSet",
    columns,
    ...(options.separator !== undefined && { separator: options.separator }),
    ...(options.spacing && { spacing: options.spacing }),
  };
}

function column(items: object[], width: string = "auto"): object {
  return { type: "Column", width, items };
}

function actionOpenUrl(title: string, url: string): object {
  return { type: "Action.OpenUrl", title, url };
}

function wrapCard(body: object[], actions?: object[]): object {
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
    ...(actions && actions.length > 0 && { actions }),
  };
}

// ── Severity / display helpers ───────────────────────────────────────

function getEffectiveSeverity(change: ChangeSummary): ChangeSeverity {
  if (change.severity === "major" || change.severity === "minor" || change.severity === "cosmetic") {
    return change.severity;
  }

  const text = [change.summary, change.whyItMatters, ...change.highlights.map((h) => h.text)]
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

type CardColor = TextBlockOptions["color"];

function severityColor(severity: ChangeSeverity): CardColor {
  switch (severity) {
    case "major":
      return "attention";
    case "minor":
      return "warning";
    default:
      return "default";
  }
}

function severityEmoji(severity: ChangeSeverity): string {
  switch (severity) {
    case "major":
      return "🔴";
    case "minor":
      return "🟡";
    default:
      return "⚪";
  }
}

function severityLabel(severity: ChangeSeverity): string {
  return severity.toUpperCase();
}

function severityContainerStyle(severity: ChangeSeverity): ContainerStyle {
  switch (severity) {
    case "major":
      return "attention";
    case "minor":
      return "warning";
    default:
      return "emphasis";
  }
}

function formatDateLabel(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString().slice(0, 10);
}

function formatCompactTitle(title: string): string {
  return title.replace(/\s+\|\s+Microsoft Learn$/i, "").trim();
}

function sortChangesForDisplay(changes: ChangeSummary[]): ChangeSummary[] {
  return [...changes].sort((left, right) => {
    const rank = (s: ChangeSeverity): number => (s === "major" ? 0 : s === "minor" ? 1 : 2);
    const delta = rank(getEffectiveSeverity(left)) - rank(getEffectiveSeverity(right));
    if (delta !== 0) return delta;
    return right.detectedAt.localeCompare(left.detectedAt);
  });
}

function countSeverities(changes: ChangeSummary[]): { major: number; minor: number; cosmetic: number } {
  return {
    major: changes.filter((c) => getEffectiveSeverity(c) === "major").length,
    minor: changes.filter((c) => getEffectiveSeverity(c) === "minor").length,
    cosmetic: changes.filter((c) => getEffectiveSeverity(c) === "cosmetic").length,
  };
}

function severityColumns(counts: { major: number; minor: number; cosmetic: number }): object {
  return columnSet([
    column([textBlock(`🔴 ${counts.major} major`, { size: "small", color: "attention" })]),
    column([textBlock(`🟡 ${counts.minor} minor`, { size: "small", color: "warning" })]),
    column([textBlock(`⚪ ${counts.cosmetic} cosmetic`, { size: "small" })]),
  ]);
}

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

// ── Single-change card block ─────────────────────────────────────────

function buildChangeBlock(change: ChangeSummary, includeDetectedAt = false): object {
  const severity = getEffectiveSeverity(change);
  const title = formatCompactTitle(change.title);

  const headerParts = [
    `${severityEmoji(severity)} **${severityLabel(severity)}**`,
    change.backfilled ? "· BACKFILLED" : "",
    includeDetectedAt ? `· ${formatDateLabel(change.detectedAt)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const items: object[] = [
    textBlock(headerParts, { size: "small", weight: "bolder", color: severityColor(severity) }),
    textBlock(title, { weight: "bolder", spacing: "none" }),
  ];

  const contentHighlights = change.highlights.filter((h) => h.type === "added" || h.type === "removed");
  const metaHighlights = change.highlights.filter((h) => h.type === "meta");

  if (contentHighlights.length > 0) {
    for (const highlight of contentHighlights.slice(0, 3)) {
      const prefix = highlight.type === "added" ? "➕" : "➖";
      const color: CardColor = highlight.type === "added" ? "good" : "attention";
      const text = highlight.text
        .replace(/^Added or expanded guidance:\s*/i, "")
        .replace(/^Removed or replaced guidance:\s*/i, "");
      items.push(textBlock(`${prefix} ${text}`, { color, size: "small" }));
    }
  } else if (change.summary) {
    items.push(textBlock(change.summary, { size: "small" }));
  }

  if (change.whyItMatters) {
    items.push(textBlock(`**Impact:** ${change.whyItMatters}`, { size: "small", isSubtle: true }));
  }

  const footerParts: string[] = [];
  for (const meta of metaHighlights) {
    const timestampMatch = meta.text.match(/timestamp changed to (\S+?)\.?$/i);
    if (timestampMatch) {
      footerParts.push(`Updated ${formatDateLabel(timestampMatch[1])}`);
      continue;
    }
    const commitMatch = meta.text.match(/commit changed to (\S+?)\.?$/i);
    if (commitMatch) {
      footerParts.push(`Commit ${commitMatch[1].slice(0, 7)}`);
      continue;
    }
  }
  footerParts.push(`[View on Learn](${change.canonicalUrl})`);

  items.push(
    textBlock(footerParts.join(" · "), { size: "small", isSubtle: true, spacing: "small" }),
  );

  return container(items, { style: severityContainerStyle(severity), separator: true });
}

// ── Public card builders ─────────────────────────────────────────────

export function buildDiffCard(result: ObservedDiffResult | undefined, requestedUrl: string): object {
  if (!result) {
    return wrapCard(
      [
        textBlock("📄 No observed diff available", { weight: "bolder", size: "medium" }),
        textBlock("No observed old/new diff is stored yet for this URL.", { isSubtle: true }),
        textBlock(
          "Exact old/new text is only available for observed changes after the bot started monitoring.",
          { size: "small", isSubtle: true },
        ),
      ],
      [actionOpenUrl("View on Learn", requestedUrl)],
    );
  }

  const severity = getEffectiveSeverity(result.change);
  const title = formatCompactTitle(result.change.title);

  const body: object[] = [
    textBlock("📄 Latest Observed Diff", { weight: "bolder", size: "medium" }),
    textBlock(title, { weight: "bolder", spacing: "none" }),

    columnSet([
      column(
        [textBlock(`Detected: ${formatDateLabel(result.change.detectedAt)}`, { size: "small", isSubtle: true })],
        "stretch",
      ),
      column(
        [
          textBlock(`${severityEmoji(severity)} ${severityLabel(severity)}`, {
            size: "small",
            weight: "bolder",
            color: severityColor(severity),
          }),
        ],
        "auto",
      ),
    ]),

    textBlock(`**Changed:** ${result.change.summary}`, { separator: true }),
    textBlock(`**Impact:** ${result.change.whyItMatters}`, { isSubtle: true, size: "small" }),
  ];

  if (result.excerpts.length > 0) {
    body.push(textBlock("**Changes**", { separator: true, weight: "bolder" }));

    for (const excerpt of result.excerpts.slice(0, 4)) {
      if (excerpt.oldText) {
        body.push(
          container(
            [textBlock(`➖ ${excerpt.oldText}`, { fontType: "monospace", color: "attention", size: "small" })],
            { style: "attention" },
          ),
        );
      }
      if (excerpt.newText) {
        body.push(
          container(
            [textBlock(`➕ ${excerpt.newText}`, { fontType: "monospace", color: "good", size: "small" })],
            { style: "good" },
          ),
        );
      }
    }
  } else {
    body.push(
      textBlock("No text excerpt could be reconstructed from the stored snapshots.", {
        isSubtle: true,
        separator: true,
      }),
    );
  }

  return wrapCard(body, [actionOpenUrl("View on Learn", result.canonicalUrl)]);
}

export function buildChangeHistoryCard(result: ChangeHistoryResult): object {
  const header = result.url ? "History for requested URL" : "History across tracked docs";
  const audienceLabel = result.audience ? ` (${result.audience})` : "";
  const windowLabel = `${formatDateLabel(result.since)} to ${formatDateLabel(result.until)}`;

  if (result.changes.length === 0) {
    return wrapCard([
      textBlock(`📊 ${header}${audienceLabel}`, { weight: "bolder", size: "medium" }),
      textBlock(`Window: ${windowLabel}`, { isSubtle: true }),
      textBlock("No stored Marketplace changes matched that scope yet.", { isSubtle: true }),
    ]);
  }

  const counts = countSeverities(result.changes);

  const topCategories = Object.entries(
    result.changes
      .flatMap((c) => c.categories)
      .reduce<Record<string, number>>((acc, cat) => {
        acc[cat] = (acc[cat] ?? 0) + 1;
        return acc;
      }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => CATEGORY_ACTIVITY_LABELS[cat as ChangeCategory])
    .join("; ");

  const body: object[] = [
    textBlock(`📊 ${header}${audienceLabel}`, { weight: "bolder", size: "medium" }),
    textBlock(`Window: ${windowLabel}`, { isSubtle: true, spacing: "none" }),
    textBlock(`**${result.changes.length}** change(s) across **${result.matchedUrls.length}** document(s)`, {
      size: "small",
    }),
    severityColumns(counts),
  ];

  if (topCategories) {
    body.push(
      textBlock(`Activity: ${topCategories}.`, { size: "small", isSubtle: true }),
    );
  }

  const sortedChanges = sortChangesForDisplay(result.changes);
  for (const change of sortedChanges) {
    body.push(buildChangeBlock(change, true));
  }

  return wrapCard(body);
}

export function buildScanDigestCard(scanResult: ScanResult): object {
  if (scanResult.changes.length === 0) {
    return wrapCard([
      textBlock("🔍 Marketplace doc scan complete", { weight: "bolder", size: "medium" }),
      textBlock(
        `Checked ${scanResult.trackedUrls.length} pages at ${formatDateLabel(scanResult.checkedAt)}`,
        { isSubtle: true },
      ),
      textBlock("No new changes detected.", { isSubtle: true }),
    ]);
  }

  const counts = countSeverities(scanResult.changes);

  const body: object[] = [
    textBlock("🔍 Marketplace documentation changes detected", { weight: "bolder", size: "medium" }),
    textBlock(`Scanned at ${formatDateLabel(scanResult.checkedAt)}`, { isSubtle: true, spacing: "none" }),
    textBlock(`**${scanResult.changes.length}** change(s) found`, { size: "small" }),
    severityColumns(counts),
  ];

  const sortedChanges = sortChangesForDisplay(scanResult.changes);
  for (const change of sortedChanges) {
    body.push(buildChangeBlock(change));
  }

  return wrapCard(body);
}

export function buildDigestHistoryCard(
  digests: DigestHistoryItem[],
  audience?: ImpactAudience,
): object {
  const filteredChanges = digests.flatMap((digest) =>
    digest.changes.filter((change) => !audience || change.audience === audience || change.audience === "both"),
  );

  if (filteredChanges.length === 0) {
    const msg = audience
      ? `No recent ${audience} impact changes are stored yet.`
      : "No recent Marketplace documentation changes are stored yet.";
    return wrapCard([
      textBlock(audience ? `📋 Recent ${audience} impact changes` : "📋 Recent changes", {
        weight: "bolder",
        size: "medium",
      }),
      textBlock(msg, { isSubtle: true }),
    ]);
  }

  const counts = countSeverities(filteredChanges);

  const body: object[] = [
    textBlock(audience ? `📋 Recent ${audience} impact changes` : "📋 Recent Marketplace changes", {
      weight: "bolder",
      size: "medium",
    }),
    textBlock(`**${filteredChanges.length}** change(s)`, { size: "small", isSubtle: true }),
    severityColumns(counts),
  ];

  const sortedChanges = sortChangesForDisplay(filteredChanges);
  for (const change of sortedChanges) {
    body.push(buildChangeBlock(change));
  }

  return wrapCard(body);
}

export function buildBackfillResultCard(result: BackfillResult): object {
  const header = result.url
    ? `Backfilled inferred history for ${result.url}`
    : "Backfilled inferred history across tracked Marketplace documentation";
  const windowLabel = `${formatDateLabel(result.since)} to ${formatDateLabel(result.until)}`;

  if (result.createdChanges === 0) {
    return wrapCard([
      textBlock("📥 Backfill complete", { weight: "bolder", size: "medium" }),
      textBlock(header, { size: "small" }),
      textBlock(`Window: ${windowLabel}`, { isSubtle: true }),
      textBlock(
        "No in-scope Learn pages had backfillable updates, or those inferred history entries were already stored.",
        { isSubtle: true },
      ),
    ]);
  }

  return wrapCard([
    textBlock("📥 Backfill complete", { weight: "bolder", size: "medium" }),
    textBlock(header, { size: "small" }),
    textBlock(`Window: ${windowLabel}`, { isSubtle: true }),
    textBlock(
      `Created **${result.createdChanges}** inferred change(s) across **${result.createdDigests}** digest day(s) from **${result.scannedUrls}** tracked page(s).`,
    ),
    textBlock(
      `Skipped ${result.skippedCount} page(s) because they were out of range, lacked usable metadata, or were already backfilled.`,
      { size: "small", isSubtle: true },
    ),
    textBlock(
      "These history entries are marked as backfilled because they come from Learn metadata rather than exact historical diffs.",
      { size: "small", isSubtle: true },
    ),
  ]);
}

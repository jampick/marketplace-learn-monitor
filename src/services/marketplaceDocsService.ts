import matter from "gray-matter";
import { diffLines } from "diff";

import { getConfig } from "../config";
import type {
  AppConfig,
  BackfillResult,
  ChangeCategory,
  ChangeHistoryQuery,
  ChangeHistoryResult,
  ChangeHighlight,
  ChangeSeverity,
  ChangeSummary,
  DigestHistoryItem,
  ImpactAudience,
  MonitoredDocument,
  ObservedDiffExcerpt,
  ObservedDiffResult,
  ScanResult,
  StoredDocumentIndex,
  StoredDocumentIndexEntry,
} from "../models";
import { createSha256 } from "../utils/hash";
import {
  createDocId,
  extractMarkdownLinks,
  toCanonicalLearnUrl,
  toMarkdownUrl,
  trimLineForDigest,
} from "../utils/learn";
import { trySummarizeWithAzureOpenAi } from "./azureOpenAi";
import { buildDigestSummary } from "./digestFormatter";
import { MonitorStateRepository } from "./monitorStateRepository";

type MetadataRecord = Record<string, unknown>;

const RELEVANCE_KEYWORDS: Array<{
  category: ChangeCategory;
  keywords: string[];
}> = [
  { category: "publishing", keywords: ["offer", "listing", "publish", "ingestion", "private offer", "saas"] },
  { category: "pricing", keywords: ["price", "pricing", "metering", "currency", "offer price"] },
  { category: "billing", keywords: ["billing", "invoice", "payout", "payment", "tax"] },
  { category: "analytics", keywords: ["insight", "analytics", "dashboard", "usage", "order"] },
  { category: "apis", keywords: ["api", "rest", "fulfillment", "metering service", "product ingestion"] },
  { category: "account", keywords: ["account", "tenant", "enroll", "permission", "publisher"] },
  { category: "support", keywords: ["support", "troubleshoot", "forum", "faq"] },
  { category: "announcements", keywords: ["announcement", "what's new", "launch enablement"] },
];

const PARTNER_KEYWORDS = [
  "partner",
  "publisher",
  "listing",
  "offer",
  "private offer",
  "publish",
  "ingestion",
  "marketplace account",
  "co-sell",
  "lead",
  "resell",
  "csp",
  "payout",
  "taxonomy",
];

const CUSTOMER_KEYWORDS = [
  "customer",
  "buyer",
  "purchase",
  "subscribe",
  "billing",
  "invoice",
  "buy",
  "checkout",
  "procurement",
  "resale",
  "usage",
];

const HIGH_SIGNAL_CHANGE_KEYWORDS = [
  "private offer",
  "billing",
  "invoice",
  "payout",
  "tax",
  "pricing",
  "price",
  "metering",
  "currency",
  "api",
  "publish",
  "offer",
  "eligibility",
  "permission",
  "checkout",
  "subscription",
  "payment",
  "procurement",
];

// Content patterns that indicate major operational impact regardless of line count
const MAJOR_IMPACT_PATTERNS = [
  "retire",
  "retired",
  "retirement",
  "deprecated",
  "deprecating",
  "discontinue",
  "end of life",
  "no longer available",
  "no longer supported",
  "must migrate",
  "breaking change",
  "mandatory",
  "required by",
  "effective date",
  "deadline",
  "will be removed",
  "sunset",
  "enforcement",
  "compliance requirement",
  "policy change",
];

// Content patterns that indicate minor/informational changes
const MINOR_IMPACT_PATTERNS = [
  "preview",
  "beta",
  "optional",
  "recommendation",
  "best practice",
  "tip",
  "note:",
  "example",
  "learn more",
  "for more information",
];

interface ContentDiffAnalysis {
  highlights: ChangeHighlight[];
  meaningfulLineCount: number;
  hasRemovedContent: boolean;
  hasChangedHeading: boolean;
  hasHighSignalKeyword: boolean;
}

export class MarketplaceDocsService {
  constructor(
    private readonly repository = new MonitorStateRepository(),
    private readonly config: AppConfig = getConfig(),
  ) {}

  async scanNow(): Promise<ScanResult> {
    const checkedAt = new Date().toISOString();
    const trackedUrls = await this.resolveTrackedUrls();
    const previousIndex = await this.repository.loadDocumentIndex();
    const updatedIndex: StoredDocumentIndex = {};
    const changes: ChangeSummary[] = [];
    const isInitialBaseline = Object.keys(previousIndex).length === 0;

    for (const trackedUrl of trackedUrls) {
      try {
        const currentDocument = await this.fetchDocument(trackedUrl);
        const previousEntry = previousIndex[currentDocument.canonicalUrl];
        const previousDocument = await this.repository.loadSnapshot(previousEntry?.snapshotPath);
        const snapshotPath = await this.repository.saveSnapshot(currentDocument);

        updatedIndex[currentDocument.canonicalUrl] = this.toIndexEntry(currentDocument, snapshotPath);

        const hasChanged =
          !previousEntry ||
          previousEntry.bodyHash !== currentDocument.bodyHash ||
          previousEntry.gitCommitId !== currentDocument.gitCommitId ||
          previousEntry.updatedAt !== currentDocument.updatedAt;

        if (!isInitialBaseline && hasChanged) {
          const change = await this.buildChangeSummary(currentDocument, previousDocument);
          if (change) {
            changes.push(change);
          }
        }
      } catch (error) {
        console.warn(
          `Failed to process Marketplace doc ${trackedUrl}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.repository.saveDocumentIndex(updatedIndex);

    if (changes.length > 0) {
      const digest: DigestHistoryItem = {
        id: this.repository.createDigestId(`${checkedAt}:${changes.map((change) => change.id).join(",")}`),
        createdAt: checkedAt,
        summary: buildDigestSummary(changes, checkedAt),
        changes,
      };
      await this.repository.saveDigest(digest);
    }

    return {
      checkedAt,
      trackedUrls,
      changes,
      summary: buildDigestSummary(changes, checkedAt),
      documentIndex: updatedIndex,
    };
  }

  async getRecentDigests(limit = 6): Promise<DigestHistoryItem[]> {
    return this.repository.loadDigestHistory(limit);
  }

  async getChangeHistory(query: ChangeHistoryQuery): Promise<ChangeHistoryResult> {
    const since = this.toValidDate(query.since, new Date(0));
    const until = this.toValidDate(query.until, new Date());
    const canonicalUrl = query.url ? this.normalizeRequestedUrl(query.url) : undefined;

    const changes = (await this.repository.loadDigestHistory())
      .flatMap((digest) => digest.changes)
      .filter((change) => {
        const detectedAt = this.toValidDate(change.detectedAt, undefined);
        if (!detectedAt) {
          return false;
        }

        return detectedAt >= since && detectedAt <= until;
      })
      .filter((change) => !canonicalUrl || change.canonicalUrl === canonicalUrl)
      .filter(
        (change) => !query.audience || change.audience === query.audience || change.audience === "both",
      )
      .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt));

    return {
      since: since.toISOString(),
      until: until.toISOString(),
      url: canonicalUrl,
      audience: query.audience,
      matchedUrls: [...new Set(changes.map((change) => change.canonicalUrl))],
      changes,
    };
  }

  async backfillHistory(query: ChangeHistoryQuery): Promise<BackfillResult> {
    const since = this.toValidDate(query.since, new Date(0));
    const until = this.toValidDate(query.until, new Date());
    const canonicalUrl = query.url ? this.normalizeRequestedUrl(query.url) : undefined;
    const targetUrls = canonicalUrl ? [canonicalUrl] : await this.resolveTrackedUrls();
    const existingChangeIds = new Set(
      (await this.repository.loadDigestHistory()).flatMap((digest) =>
        digest.changes.map((change) => change.id),
      ),
    );
    const digestsByDay = new Map<string, ChangeSummary[]>();
    let skippedCount = 0;

    for (const targetUrl of targetUrls) {
      try {
        const currentDocument = await this.fetchDocument(targetUrl);
        const updatedAt = this.toValidDate(currentDocument.updatedAt, undefined);
        if (!updatedAt || updatedAt < since || updatedAt > until) {
          skippedCount += 1;
          continue;
        }

        const change = this.buildBackfilledChangeSummary(currentDocument, updatedAt);
        if (existingChangeIds.has(change.id)) {
          skippedCount += 1;
          continue;
        }

        const dayKey = change.detectedAt.slice(0, 10);
        const changesForDay = digestsByDay.get(dayKey) ?? [];
        changesForDay.push(change);
        digestsByDay.set(dayKey, changesForDay);
        existingChangeIds.add(change.id);
      } catch (error) {
        console.warn(
          `Failed to backfill Marketplace doc ${targetUrl}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        skippedCount += 1;
      }
    }

    let createdDigests = 0;
    let createdChanges = 0;
    for (const dayKey of [...digestsByDay.keys()].sort((left, right) => right.localeCompare(left))) {
      const changes = digestsByDay.get(dayKey) ?? [];
      if (changes.length === 0) {
        continue;
      }

      const createdAt = `${dayKey}T12:00:00.000Z`;
      const digest: DigestHistoryItem = {
        id: this.repository.createDigestId(`backfill:${createdAt}:${changes.map((change) => change.id).join(",")}`),
        createdAt,
        summary: buildDigestSummary(changes, createdAt),
        changes,
      };

      await this.repository.saveDigest(digest);
      createdDigests += 1;
      createdChanges += changes.length;
    }

    return {
      since: since.toISOString(),
      until: until.toISOString(),
      url: canonicalUrl,
      scannedUrls: targetUrls.length,
      createdDigests,
      createdChanges,
      skippedCount,
    };
  }

  async getLastObservedDiff(rawUrl: string): Promise<ObservedDiffResult | undefined> {
    const canonicalUrl = this.normalizeRequestedUrl(rawUrl);
    const latestObservedChange = (await this.repository.loadDigestHistory())
      .flatMap((digest) => digest.changes)
      .filter((change) => change.canonicalUrl === canonicalUrl && !change.backfilled)
      .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))[0];

    if (!latestObservedChange) {
      return undefined;
    }

    const snapshots = await this.repository.listSnapshots(latestObservedChange.docId);
    const currentSnapshotIndex = snapshots.findIndex(
      (snapshot) => snapshot.fetchedAt === latestObservedChange.detectedAt,
    );

    if (currentSnapshotIndex <= 0) {
      return undefined;
    }

    const previousSnapshot = snapshots[currentSnapshotIndex - 1];
    const currentSnapshot = snapshots[currentSnapshotIndex];
    if (!previousSnapshot || !currentSnapshot) {
      return undefined;
    }

    return {
      canonicalUrl,
      change: latestObservedChange,
      previousFetchedAt: previousSnapshot.fetchedAt,
      currentFetchedAt: currentSnapshot.fetchedAt,
      previousUpdatedAt: previousSnapshot.updatedAt,
      currentUpdatedAt: currentSnapshot.updatedAt,
      excerpts: this.buildObservedDiffExcerpts(previousSnapshot.body, currentSnapshot.body),
    };
  }

  async getTrackedSourceUrls(): Promise<string[]> {
    return this.resolveTrackedUrls();
  }

  async getStatus(): Promise<{ trackedCount: number; lastDigestAt?: string }> {
    const index = await this.repository.loadDocumentIndex();
    const digests = await this.repository.loadDigestHistory(1);

    return {
      trackedCount: Object.keys(index).length,
      lastDigestAt: digests[0]?.createdAt,
    };
  }

  async resolveUrlFromTitle(text: string): Promise<string | undefined> {
    const index = await this.repository.loadDocumentIndex();
    const lowerText = text.toLowerCase();

    for (const entry of Object.values(index)) {
      const titleLower = entry.title.toLowerCase();
      if (lowerText.includes(titleLower) || titleLower.includes(lowerText)) {
        return entry.canonicalUrl;
      }
    }

    return undefined;
  }

  private async resolveTrackedUrls(): Promise<string[]> {
    const urls = new Set<string>();

    const landingResponse = await fetch(this.config.marketplaceLandingUrl, {
      headers: {
        Accept: "text/markdown",
      },
    });

    if (!landingResponse.ok) {
      throw new Error(`Failed to fetch landing page: ${landingResponse.status}`);
    }

    const landingMarkdown = await landingResponse.text();
    const landingCanonical = toCanonicalLearnUrl(this.config.marketplaceLandingUrl);
    urls.add(landingCanonical);

    for (const linkedUrl of extractMarkdownLinks(landingMarkdown, landingCanonical)) {
      if (this.isAllowedUrl(linkedUrl)) {
        urls.add(linkedUrl);
      }
    }

    try {
      const announcements = await this.getAnnouncementUrls();
      for (const announcementUrl of announcements) {
        urls.add(announcementUrl);
      }
    } catch (error) {
      console.warn(
        `Failed to resolve announcement pages: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return [...urls].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  }

  private async getAnnouncementUrls(): Promise<string[]> {
    const response = await fetch(this.config.partnerCenterTocUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Partner Center TOC: ${response.status}`);
    }

    const toc = (await response.json()) as { items?: unknown[] };
    const announcementUrls = new Set<string>();

    const walkItems = (items: unknown[]): void => {
      for (const item of items) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const candidate = item as { href?: unknown; children?: unknown[] };
        if (typeof candidate.href === "string" && candidate.href.startsWith("announcements/")) {
          announcementUrls.add(
            toCanonicalLearnUrl(`https://learn.microsoft.com/en-us/partner-center/${candidate.href}`),
          );
        }

        if (Array.isArray(candidate.children)) {
          walkItems(candidate.children);
        }
      }
    };

    walkItems(Array.isArray(toc.items) ? toc.items : []);

    return [...announcementUrls]
      .filter((url) => /announcements\/20\d{2}-/.test(url))
      .sort((left, right) => right.localeCompare(left, "en", { sensitivity: "base" }))
      .slice(0, this.config.maxAnnouncementPages);
  }

  private async fetchDocument(rawUrl: string): Promise<MonitoredDocument> {
    const canonicalUrl = toCanonicalLearnUrl(rawUrl);
    const markdownUrl = toMarkdownUrl(canonicalUrl);
    const response = await fetch(markdownUrl, {
      headers: {
        Accept: "text/markdown",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${canonicalUrl}: ${response.status}`);
    }

    const markdown = await response.text();
    const parsed = matter(markdown);
    const metadata = parsed.data as MetadataRecord;
    const content = parsed.content.trim();
    const title = this.readString(metadata.title) ?? this.extractTitleFromContent(content) ?? canonicalUrl;
    const sourcePath = this.readString(metadata.source_path);
    const docId = createDocId(sourcePath ?? canonicalUrl);

    return {
      docId,
      url: markdownUrl,
      canonicalUrl,
      title,
      summary: this.readString(metadata.summary) ?? this.readString(metadata.description),
      sourcePath,
      gitCommitId: this.readString(metadata.git_commit_id),
      updatedAt: this.readString(metadata.updated_at) ?? this.readString(metadata["ms.date"]),
      fetchedAt: new Date().toISOString(),
      bodyHash: createSha256(content),
      body: content,
      headings: this.extractHeadings(content),
    };
  }

  private toIndexEntry(
    document: MonitoredDocument,
    snapshotPath: string,
  ): StoredDocumentIndexEntry {
    return {
      docId: document.docId,
      url: document.url,
      canonicalUrl: document.canonicalUrl,
      title: document.title,
      summary: document.summary,
      sourcePath: document.sourcePath,
      gitCommitId: document.gitCommitId,
      updatedAt: document.updatedAt,
      fetchedAt: document.fetchedAt,
      bodyHash: document.bodyHash,
      snapshotPath,
    };
  }

  private async buildChangeSummary(
    current: MonitoredDocument,
    previous: MonitoredDocument | undefined,
  ): Promise<ChangeSummary | undefined> {
    const metadataHighlights = this.buildMetadataHighlights(previous, current);
    const contentAnalysis = this.analyzeContentDiff(previous?.body ?? "", current.body);
    const contentHighlights = contentAnalysis.highlights;
    const highlights = [...metadataHighlights, ...contentHighlights].slice(0, 6);

    if (!previous) {
      highlights.unshift({
        type: "meta",
        text: "New Marketplace documentation page started being tracked.",
      });
    }

    const lowerContext = [
      current.canonicalUrl,
      current.title,
      current.summary ?? "",
      current.sourcePath ?? "",
      ...highlights.map((highlight) => highlight.text),
    ]
      .join(" ")
      .toLowerCase();

    const audience = this.classifyAudience(lowerContext);
    const categories = this.classifyCategories(lowerContext);
    const severity = this.classifySeverity(previous, metadataHighlights, contentAnalysis);

    const fallbackSummary = this.buildFallbackSummary(previous, current, highlights, severity);
    const fallbackWhyItMatters = this.buildWhyItMatters(audience, categories, current, severity, highlights);

    const prompt = [
      `Title: ${current.title}`,
      `URL: ${current.canonicalUrl}`,
      `Source path: ${current.sourcePath ?? "unknown"}`,
      `Audience hint: ${audience}`,
      `Category hints: ${categories.join(", ")}`,
      "Highlights:",
      ...highlights.map((highlight) => `- ${highlight.type}: ${highlight.text}`),
    ].join("\n");

    let summary = fallbackSummary;
    let whyItMatters = fallbackWhyItMatters;
    let refinedAudience = audience;
    let refinedCategories = categories;

    try {
      const aiSummary = await trySummarizeWithAzureOpenAi(this.config.azureOpenAi, prompt);
      if (aiSummary) {
        summary = this.shortenForDigest(aiSummary.summary, 140) ?? fallbackSummary;
        whyItMatters = this.shortenForDigest(aiSummary.whyItMatters, 120) ?? fallbackWhyItMatters;
        refinedAudience = aiSummary.audience;
        refinedCategories = aiSummary.categories;
      }
    } catch (error) {
      console.warn(
        `Azure OpenAI summarization failed for ${current.canonicalUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      id: createSha256(`${current.canonicalUrl}:${current.bodyHash}:${current.updatedAt ?? ""}`).slice(0, 24),
      docId: current.docId,
      title: current.title,
      canonicalUrl: current.canonicalUrl,
      sourcePath: current.sourcePath,
      updatedAt: current.updatedAt,
      gitCommitId: current.gitCommitId,
      audience: refinedAudience,
      severity,
      categories: refinedCategories,
      summary: this.shortenForDigest(summary, 140) ?? fallbackSummary,
      whyItMatters: this.shortenForDigest(whyItMatters, 120) ?? fallbackWhyItMatters,
      highlights,
      detectedAt: current.fetchedAt,
    };
  }

  private buildMetadataHighlights(
    previous: MonitoredDocument | undefined,
    current: MonitoredDocument,
  ): ChangeHighlight[] {
    const highlights: ChangeHighlight[] = [];

    if (!previous) {
      return highlights;
    }

    if (previous.updatedAt !== current.updatedAt && current.updatedAt) {
      highlights.push({
        type: "meta",
        text: `The page's published update timestamp changed to ${current.updatedAt}.`,
      });
    }

    if (previous.gitCommitId !== current.gitCommitId && current.gitCommitId) {
      highlights.push({
        type: "meta",
        text: `The backing Learn source commit changed to ${current.gitCommitId.slice(0, 12)}.`,
      });
    }

    if (previous.title !== current.title) {
      highlights.push({
        type: "meta",
        text: `The page title changed from "${previous.title}" to "${current.title}".`,
      });
    }

    return highlights;
  }

  private analyzeContentDiff(previousBody: string, currentBody: string): ContentDiffAnalysis {
    const highlights: ChangeHighlight[] = [];
    let meaningfulLineCount = 0;
    let hasRemovedContent = false;
    let hasChangedHeading = false;
    let hasHighSignalKeyword = false;
    const differences = diffLines(previousBody, currentBody);

    for (const difference of differences) {
      const changeType: ChangeHighlight["type"] | undefined = difference.added
        ? "added"
        : difference.removed
          ? "removed"
          : undefined;

      if (!changeType) {
        continue;
      }

      if (changeType === "removed") {
        hasRemovedContent = true;
      }

      const rawLines = difference.value.split(/\r?\n/);
      if (rawLines.some((line) => /^#{1,3}\s+/.test(line.trim()))) {
        hasChangedHeading = true;
      }

      const lines = rawLines
        .map((line) => trimLineForDigest(line))
        .filter((line) => line.length > 12)
        .filter((line) => !line.startsWith("---"))
        .filter((line) => !line.startsWith("layout:"))
        .filter((line) => !line.startsWith("ms.date:"));

      meaningfulLineCount += lines.length;
      if (
        lines.some((line) =>
          HIGH_SIGNAL_CHANGE_KEYWORDS.some((keyword) => line.toLowerCase().includes(keyword)),
        )
      ) {
        hasHighSignalKeyword = true;
      }

      for (const line of lines.slice(0, 3)) {
        highlights.push({
          type: changeType,
          text:
            changeType === "added"
              ? `Added or expanded guidance: ${line}`
              : `Removed or replaced guidance: ${line}`,
        });
      }

      if (highlights.length >= 6) {
        break;
      }
    }

    return {
      highlights,
      meaningfulLineCount,
      hasRemovedContent,
      hasChangedHeading,
      hasHighSignalKeyword,
    };
  }

  private classifyAudience(context: string): ImpactAudience {
    const hasPartnerSignal = PARTNER_KEYWORDS.some((keyword) => context.includes(keyword));
    const hasCustomerSignal = CUSTOMER_KEYWORDS.some((keyword) => context.includes(keyword));

    if (hasPartnerSignal && hasCustomerSignal) {
      return "both";
    }

    if (hasCustomerSignal) {
      return "customer";
    }

    return "partner";
  }

  private classifyCategories(context: string): ChangeCategory[] {
    const categories = RELEVANCE_KEYWORDS
      .filter((rule) => rule.keywords.some((keyword) => context.includes(keyword)))
      .map((rule) => rule.category);

    return categories.length > 0 ? [...new Set(categories)] : ["other"];
  }

  private buildWhyItMatters(
    audience: ImpactAudience,
    categories: ChangeCategory[],
    current: MonitoredDocument,
    severity: ChangeSeverity,
    highlights: ChangeHighlight[] = [],
  ): string {
    if (severity === "cosmetic") {
      return "No likely operational impact; this looks like a cosmetic or metadata-only update.";
    }

    const audienceLabel =
      audience === "both"
        ? "Partners and customers"
        : audience === "customer"
          ? "Customers"
          : "Partners";

    const contentHighlights = highlights.filter((h) => h.type === "added" || h.type === "removed");
    const changedText = contentHighlights
      .map((h) => this.extractSubject(h.text))
      .join(" ")
      .toLowerCase();

    // Detect specific change scenarios and produce tailored impact
    const scenario = this.detectChangeScenario(changedText);
    if (scenario && contentHighlights.length > 0) {
      const subject = this.extractSubject(contentHighlights[0].text);
      if (subject) {
        return this.shortenForDigest(
          `${audienceLabel} ${scenario.replace("{subject}", subject)}`,
          120,
        ) ?? `${audienceLabel} ${scenario.replace("{subject}", subject)}`;
      }
    }

    // Analytical impact based on change shape
    if (contentHighlights.length > 0) {
      const hasAdded = contentHighlights.some((h) => h.type === "added");
      const hasRemoved = contentHighlights.some((h) => h.type === "removed");
      const primarySubject = this.shortenForDigest(
        this.extractSubject(contentHighlights[0].text),
        60,
      ) ?? this.extractSubject(contentHighlights[0].text);

      if (primarySubject && primarySubject.length > 8) {
        if (hasAdded && hasRemoved) {
          return `${audienceLabel} should review updated guidance: ${primarySubject}.`;
        }
        if (hasRemoved) {
          return `${audienceLabel} should verify workflows after removed guidance: ${primarySubject}.`;
        }
        return `${audienceLabel} should review: ${primarySubject}.`;
      }
    }

    const category = categories[0] ?? "other";
    const categoryFallback: Record<ChangeCategory, string> = {
      account: "may need to review updated onboarding or account setup steps.",
      publishing: "may need to review updated offer setup or submission steps.",
      pricing: "may need to review updated pricing or metering guidance.",
      billing: "may need to review updated billing, payout, or tax steps.",
      analytics: "may need to review updated reporting or analytics guidance.",
      apis: "may need to review updated API or integration guidance.",
      support: "may need to review updated support or troubleshooting guidance.",
      announcements: "should review this announcement for actionable changes.",
      other: "may need to review updated Marketplace guidance.",
    };

    return `${audienceLabel} ${categoryFallback[category]}`;
  }

  private extractSubject(highlightText: string): string {
    const cleaned = highlightText
      .replace(/^Added or expanded guidance:\s*/i, "")
      .replace(/^Removed or replaced guidance:\s*/i, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // strip markdown links
      .replace(/\*+/g, "")                        // strip markdown bold/italic
      .replace(/^Date\**:\s*/i, "")                // strip date labels
      .replace(/\s+/g, " ")
      .trim();

    // Take only the first sentence or clause for conciseness
    const firstSentence = cleaned.split(/[.;:!?\n]/).filter((s) => s.trim().length > 8)[0];
    return (firstSentence ?? cleaned).trim();
  }

  private detectChangeScenario(changedText: string): string | undefined {
    if (/\b(?:retire|retirement|retired|sunset)\b/.test(changedText)) {
      return "may be affected by program retirement: {subject}.";
    }

    if (/\b(?:deprecated|deprecating|end of life|will be removed)\b/.test(changedText)) {
      return "should migrate before deprecation: {subject}.";
    }

    if (/\b(?:no longer available|no longer supported|discontinue)\b/.test(changedText)) {
      return "should confirm no workflow dependency: {subject}.";
    }

    if (/\b(?:mandatory|required by|compliance requirement|enforcement|must)\b/.test(changedText)) {
      return "must meet new requirement: {subject}.";
    }

    if (/\b(?:deadline|effective date)\b/.test(changedText)) {
      return "should note deadline: {subject}.";
    }

    if (/\b(?:breaking change|migration required|must migrate)\b/.test(changedText)) {
      return "must update integration: {subject}.";
    }

    if (/\b(?:new api|new endpoint|api version)\b/.test(changedText)) {
      return "should evaluate API update: {subject}.";
    }

    if (/\b(?:price|pricing model|pricing change|fee)\b/.test(changedText)) {
      return "should review pricing impact: {subject}.";
    }

    if (/\b(?:payout|payment|revenue share|invoice)\b/.test(changedText)) {
      return "should verify billing config: {subject}.";
    }

    return undefined;
  }

  private buildBackfilledChangeSummary(
    current: MonitoredDocument,
    detectedAt: Date,
  ): ChangeSummary {
    const lowerContext = [
      current.canonicalUrl,
      current.title,
      current.summary ?? "",
      current.sourcePath ?? "",
      ...current.headings,
    ]
      .join(" ")
      .toLowerCase();
    const audience = this.classifyAudience(lowerContext);
    const categories = this.classifyCategories(lowerContext);
    const severity: ChangeSeverity = "minor";
    const detectedAtIso = detectedAt.toISOString();
    const updateLabel = current.updatedAt ?? detectedAtIso.slice(0, 10);
    const whyItMatters = `${this.buildWhyItMatters(audience, categories, current, severity)} Exact diff unavailable.`;

    return {
      id: createSha256(`backfill:${current.canonicalUrl}:${detectedAtIso}`).slice(0, 24),
      docId: current.docId,
      title: current.title,
      canonicalUrl: current.canonicalUrl,
      sourcePath: current.sourcePath,
      updatedAt: current.updatedAt,
      gitCommitId: current.gitCommitId,
      audience,
      severity,
      categories,
      summary: `Backfilled update on ${updateLabel}; exact diff unavailable.`,
      whyItMatters,
      highlights: [
        {
          type: "meta" as const,
          text: "Backfilled from Microsoft Learn metadata. Exact historical diff was not available.",
        },
        ...(current.updatedAt
          ? [
              {
                type: "meta" as const,
                text: `Learn currently reports the page's update timestamp as ${current.updatedAt}.`,
              },
            ]
          : []),
        ...(current.summary
          ? [
              {
                type: "meta" as const,
                text: `Current page scope: ${trimLineForDigest(current.summary)}`,
              },
            ]
          : []),
      ].slice(0, 3),
      detectedAt: detectedAtIso,
      backfilled: true,
    };
  }

  private classifySeverity(
    previous: MonitoredDocument | undefined,
    metadataHighlights: ChangeHighlight[],
    contentAnalysis: ContentDiffAnalysis,
  ): ChangeSeverity {
    if (!previous) {
      return "major";
    }

    if (contentAnalysis.meaningfulLineCount === 0) {
      return "cosmetic";
    }

    // Check actual content for high-impact patterns (retirement, deprecation, etc.)
    const changedText = contentAnalysis.highlights
      .map((h) => h.text)
      .join(" ")
      .toLowerCase();

    const hasMajorImpactPattern = MAJOR_IMPACT_PATTERNS.some((p) => changedText.includes(p));
    if (hasMajorImpactPattern) {
      return "major";
    }

    // Check if all content matches minor/informational patterns
    const hasOnlyMinorPatterns = contentAnalysis.highlights.length > 0 &&
      contentAnalysis.highlights.every((h) =>
        MINOR_IMPACT_PATTERNS.some((p) => h.text.toLowerCase().includes(p)),
      );
    if (hasOnlyMinorPatterns) {
      return "minor";
    }

    if (
      contentAnalysis.hasChangedHeading ||
      contentAnalysis.meaningfulLineCount >= 6 ||
      (contentAnalysis.hasHighSignalKeyword &&
        (contentAnalysis.meaningfulLineCount >= 2 || contentAnalysis.hasRemovedContent))
    ) {
      return "major";
    }

    return "minor";
  }

  private buildFallbackSummary(
    previous: MonitoredDocument | undefined,
    current: MonitoredDocument,
    highlights: ChangeHighlight[],
    severity: ChangeSeverity,
  ): string {
    if (!previous) {
      return `New tracked page: ${current.title}`;
    }

    const primaryContentHighlight = highlights.find((highlight) => highlight.type !== "meta");
    if (primaryContentHighlight) {
      return this.toShortHighlightText(primaryContentHighlight);
    }

    const primaryHighlight = highlights[0];
    if (primaryHighlight) {
      return this.toShortHighlightText(primaryHighlight);
    }

    return severity === "cosmetic" ? "Metadata or wording update only." : `Updated ${current.title}.`;
  }

  private toShortHighlightText(highlight: ChangeHighlight): string {
    switch (highlight.type) {
      case "added":
        return highlight.text.replace(/^Added or expanded guidance:\s*/i, "Added: ");
      case "removed":
        return highlight.text.replace(/^Removed or replaced guidance:\s*/i, "Removed: ");
      default:
        return highlight.text
          .replace(/^The page's published update timestamp changed to .+\.$/i, "Published update timestamp changed.")
          .replace(/^The backing Learn source commit changed to .+\.$/i, "Source commit changed.")
          .replace(/^The page title changed from .+\.$/i, "Page title changed.");
    }
  }

  private shortenForDigest(value: string | undefined, maxLength: number): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
  }

  private buildObservedDiffExcerpts(
    previousBody: string,
    currentBody: string,
  ): ObservedDiffExcerpt[] {
    const differences = diffLines(previousBody, currentBody);
    const excerpts: ObservedDiffExcerpt[] = [];

    for (let index = 0; index < differences.length; index += 1) {
      const difference = differences[index];
      if (!difference.added && !difference.removed) {
        continue;
      }

      if (difference.removed && differences[index + 1]?.added) {
        excerpts.push({
          oldText: this.toExcerpt(difference.value),
          newText: this.toExcerpt(differences[index + 1].value),
        });
        index += 1;
      } else {
        excerpts.push({
          oldText: difference.removed ? this.toExcerpt(difference.value) : undefined,
          newText: difference.added ? this.toExcerpt(difference.value) : undefined,
        });
      }

      if (excerpts.length >= 3) {
        break;
      }
    }

    return excerpts.filter((excerpt) => excerpt.oldText || excerpt.newText);
  }

  private extractTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim();
  }

  private extractHeadings(content: string): string[] {
    return [...content.matchAll(/^#{1,3}\s+(.+)$/gm)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, 12);
  }

  private readString(value: unknown): string | undefined {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private toExcerpt(value: string): string | undefined {
    const lines = value
      .split(/\r?\n/)
      .map((line) => trimLineForDigest(line))
      .filter((line) => line.length > 12)
      .filter((line) => !line.startsWith("---"))
      .filter((line) => !line.startsWith("layout:"))
      .slice(0, 2);

    return lines.length > 0 ? lines.join(" ") : undefined;
  }

  private normalizeRequestedUrl(url: string): string {
    try {
      return toCanonicalLearnUrl(url);
    } catch {
      return url.trim();
    }
  }

  private toValidDate(value: string, fallback: Date): Date;
  private toValidDate(value: string | undefined, fallback: undefined): Date | undefined;
  private toValidDate(value: string | undefined, fallback: Date | undefined): Date | undefined {
    if (!value) {
      return fallback;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? fallback : parsed;
  }

  private isAllowedUrl(url: string): boolean {
    return this.config.allowedDocPrefixes.some((prefix) => url.startsWith(prefix));
  }
}

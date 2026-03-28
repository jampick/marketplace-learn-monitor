import {
  ActivityHandler,
  CardFactory,
  MessageFactory,
  TurnContext,
  type ConversationReference,
} from "botbuilder";

import { extractRequestedUrl, isHistoryQuery, parseHistoryQuery } from "./historyQuery";
import {
  formatBackfillResult,
  formatChangeHistory,
  formatDigestHistory,
  formatObservedDiff,
  formatScanDigest,
} from "../services/digestFormatter";
import {
  buildBackfillResultCard,
  buildChangeHistoryCard,
  buildDiffCard,
  buildDigestHistoryCard,
  buildScanDigestCard,
} from "../services/adaptiveCardFormatter";
import { MarketplaceDocsService } from "../services/marketplaceDocsService";
import { MonitorStateRepository } from "../services/monitorStateRepository";
import type { ConversationRegistration, ScanResult } from "../models";
import { getAppVersion } from "../version";
import { buildTestScanResult } from "./testFixture";

export interface BotReply {
  text: string;
  card?: object;
}

function getAdminUserIds(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS?.trim();
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw.split(/[;,]/).map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
}

const ADMIN_COMMANDS = ["scan", "backfill", "test scan", "test digest"];

const ADMIN_ONLY_MESSAGE =
  "This command is restricted to admins. Try `what changed today`, `partner impact`, `customer impact`, `history last 30 days`, or `legend`.";

export const HELP_MESSAGE = [
  "I monitor Microsoft Marketplace documentation changes from Microsoft Learn.",
  "",
  "Try one of these commands:",
  "- `scan now`",
  "- `test scan`",
  "- `what changed today`",
  "- `partner impact`",
  "- `customer impact`",
  "- `history last 30 days`",
  "- `history for https://learn.microsoft.com/... last 60 days`",
  "- `backfill last 30 days`",
  "- `show diff for https://learn.microsoft.com/...`",
  "- `sources`",
  "- `status`",
  "- `legend`",
  "",
  "In a group chat, mention me with `@Marketplace Learn Monitor` before your command.",
].join("\n");

export const LEGEND_MESSAGE = [
  "**Change card legend**",
  "",
  "**Severity**",
  "- 🔴 **MAJOR** — Heading changed, 6+ content lines changed, or high-signal keywords (billing, pricing, tax, private offer) with substantive edits",
  "- 🟡 **MINOR** — Some content changed but doesn't hit major thresholds",
  "- ⚪ **COSMETIC** — Metadata-only update (timestamp, commit hash, or title tweak)",
  "",
  "**Content changes**",
  "- ➕ Added or expanded guidance",
  "- ➖ Removed or replaced guidance",
  "",
  "**Impact** — A summary of why this change matters, derived from the actual added/removed content",
  "",
  "**Audience** (used for filtering with `partner impact` / `customer impact`)",
  "- `partner` — publisher or seller-side workflows",
  "- `customer` — buyer-side workflows",
  "- `both` — shared impact",
  "",
  "**Footer** — Page update date, Learn source commit, and link to the page",
].join("\n");

const MAX_TEAMS_TEXT_CHUNK_LENGTH = 3800;

export class MarketplaceMonitorBot extends ActivityHandler {
  constructor(
    private readonly docsService: MarketplaceDocsService,
    private readonly repository: MonitorStateRepository,
  ) {
    super();

    this.onMessage(async (context, next) => {
      try {
        await this.captureConversation(context);
      } catch (error) {
        console.warn(
          "Failed to capture conversation reference:",
          error instanceof Error ? error.message : String(error),
        );
      }

      const text = this.getNormalizedText(context);
      const rawText = context.activity.text ?? "";
      const aadObjectId = context.activity.from?.aadObjectId?.toLowerCase() ?? "";
      const fromId = context.activity.from?.id ?? "";
      const isAdmin = this.isAdminUser(aadObjectId);

      let response: BotReply;
      try {
        response = await this.getResponse(text, isAdmin, { aadObjectId, fromId, rawText });
      } catch (error) {
        console.error(
          "Failed to generate bot response:",
          error instanceof Error ? error.message : String(error),
        );
        response = {
          text: "Something went wrong while processing your request. Please try again in a moment.",
        };
      }

      await this.sendTurnReply(context, response);

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      try {
        await this.captureConversation(context);
      } catch (error) {
        console.warn(
          "Failed to capture conversation on member add:",
          error instanceof Error ? error.message : String(error),
        );
      }

      const botId = context.activity.recipient?.id;
      const botWasAdded = (context.activity.membersAdded ?? []).some((member) => member.id === botId);
      if (botWasAdded) {
        await this.sendTurnReply(context, { text: HELP_MESSAGE });
      }

      await next();
    });
  }

  private async captureConversation(
    context: TurnContext,
  ): Promise<ConversationRegistration> {
    const activity = context.activity;
    const reference = TurnContext.getConversationReference(activity);
    const conversation = activity.conversation;
    const registration: ConversationRegistration = {
      id: conversation.id,
      scope: this.getConversationScope(conversation.conversationType),
      conversationReference: reference as Partial<ConversationReference>,
      addedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      tenantId: activity.conversation?.tenantId,
      conversationId: conversation.id,
      conversationName: conversation.name,
      userId: activity.from?.id,
      userName: activity.from?.name,
      aadObjectId: activity.from?.aadObjectId,
    };

    const existing = (await this.repository.listConversations()).find(
      (conversationItem) => conversationItem.id === registration.id,
    );

    if (existing) {
      registration.addedAt = existing.addedAt;
      registration.lastDigestAt = existing.lastDigestAt;
    }

    await this.repository.saveConversation(registration);
    return registration;
  }

  public async getResponse(
    text: string,
    isAdmin = true,
    userInfo: { aadObjectId: string; fromId: string; rawText?: string } = { aadObjectId: "", fromId: "" },
  ): Promise<BotReply> {
    const normalized = text.trim().toLowerCase();
    if (!normalized || normalized === "help") {
      return { text: HELP_MESSAGE };
    }

    if (normalized === "legend") {
      return { text: LEGEND_MESSAGE };
    }

    if (normalized === "whoami") {
      return {
        text: [
          `AAD Object ID: ${userInfo.aadObjectId || "(not available)"}`,
          `From ID: ${userInfo.fromId || "(not available)"}`,
          `Admin: ${isAdmin ? "yes" : "no"}`,
        ].join("\n"),
      };
    }

    if (!isAdmin && ADMIN_COMMANDS.some((cmd) => normalized.includes(cmd))) {
      return { text: ADMIN_ONLY_MESSAGE };
    }

    if (normalized.includes("test scan") || normalized.includes("test digest")) {
      const scanResult = buildTestScanResult();
      return {
        text: formatScanDigest(scanResult),
        card: buildScanDigestCard(scanResult),
      };
    }

    if (normalized.includes("scan")) {
      const statusBefore = await this.docsService.getStatus();
      const scanResult = await this.docsService.scanNow();

      if (statusBefore.trackedCount === 0 && scanResult.changes.length === 0) {
        return {
          text: `Baseline created for ${scanResult.trackedUrls.length} Marketplace pages. Ask me again after the next changes land.`,
        };
      }

      return {
        text: formatScanDigest(scanResult),
        card: buildScanDigestCard(scanResult),
      };
    }

    if (normalized.includes("status")) {
      const status = await this.docsService.getStatus();
      return {
        text: [
          `Version: ${getAppVersion()}`,
          `Tracked pages: ${status.trackedCount}`,
          `Last stored digest: ${status.lastDigestAt ?? "none yet"}`,
        ].join("\n"),
      };
    }

    if (normalized.includes("source")) {
      const sources = await this.docsService.getTrackedSourceUrls();
      return {
        text: [
          `Currently tracking ${sources.length} Marketplace-related pages:`,
          ...sources.map((source) => `- ${source}`),
        ].join("\n"),
      };
    }

    if (normalized.includes("show diff") || normalized.includes("last change")) {
      let url = extractRequestedUrl(userInfo.rawText ?? text) ?? extractRequestedUrl(text);
      if (!url) {
        url = await this.docsService.resolveUrlFromTitle(text);
      }
      if (!url) {
        return {
          text: "Include a Learn URL, for example `show diff for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/`.",
        };
      }

      const diffResult = await this.docsService.getLastObservedDiff(url);
      return {
        text: formatObservedDiff(diffResult, url),
        card: buildDiffCard(diffResult, url),
      };
    }

    if (normalized.includes("backfill")) {
      const backfillQuery = parseHistoryQuery(userInfo.rawText ?? text);
      const backfillResult = await this.docsService.backfillHistory(backfillQuery);
      return {
        text: formatBackfillResult(backfillResult),
        card: buildBackfillResultCard(backfillResult),
      };
    }

    if (isHistoryQuery(text)) {
      const historyResult = await this.docsService.getChangeHistory(parseHistoryQuery(userInfo.rawText ?? text));
      return {
        text: formatChangeHistory(historyResult),
        card: buildChangeHistoryCard(historyResult),
      };
    }

    if (normalized.includes("partner")) {
      const digests = await this.docsService.getRecentDigests();
      return {
        text: formatDigestHistory(digests, "partner"),
        card: buildDigestHistoryCard(digests, "partner"),
      };
    }

    if (normalized.includes("customer")) {
      const digests = await this.docsService.getRecentDigests();
      return {
        text: formatDigestHistory(digests, "customer"),
        card: buildDigestHistoryCard(digests, "customer"),
      };
    }

    if (normalized.includes("what changed") || normalized.includes("today") || normalized.includes("digest")) {
      const digests = await this.docsService.getRecentDigests();
      return {
        text: formatDigestHistory(digests),
        card: buildDigestHistoryCard(digests),
      };
    }

    return { text: HELP_MESSAGE };
  }

  private getNormalizedText(context: TurnContext): string {
    const removedMention = TurnContext.removeRecipientMention(context.activity);
    return (removedMention || context.activity.text || "").trim();
  }

  private async sendTurnReply(context: TurnContext, reply: BotReply): Promise<void> {
    if (reply.card) {
      await context.sendActivity({
        attachments: [CardFactory.adaptiveCard(reply.card)],
      });
      return;
    }

    const message = reply.text;
    if (message.length <= MAX_TEAMS_TEXT_CHUNK_LENGTH) {
      await context.sendActivity(MessageFactory.text(message));
      return;
    }

    for (const chunk of this.splitMessageForTeams(message)) {
      await context.sendActivity(MessageFactory.text(chunk));
    }
  }

  private splitMessageForTeams(message: string): string[] {
    const lines = message
      .replace(/\r/g, "")
      .split("\n");

    const chunks: string[] = [];
    let currentChunk = "";

    for (const line of lines) {
      const candidate = currentChunk ? `${currentChunk}\n${line}` : line;
      if (candidate.length <= MAX_TEAMS_TEXT_CHUNK_LENGTH) {
        currentChunk = candidate;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = line.length <= MAX_TEAMS_TEXT_CHUNK_LENGTH
          ? line
          : line.slice(0, MAX_TEAMS_TEXT_CHUNK_LENGTH);
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks.length > 0 ? chunks : [message];
  }

  private getConversationScope(
    conversationType: string | undefined,
  ): ConversationRegistration["scope"] {
    switch (conversationType) {
      case "personal":
        return "personal";
      case "groupChat":
        return "groupChat";
      case "channel":
        return "team";
      default:
        return "unknown";
    }
  }

  private isAdminUser(aadObjectId: string): boolean {
    const adminIds = getAdminUserIds();
    if (adminIds.size === 0) {
      return true;
    }
    return adminIds.has(aadObjectId);
  }
}


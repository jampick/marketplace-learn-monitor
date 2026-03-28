import {
  app,
  type InvocationContext,
  type Timer,
} from "@azure/functions";

import { adapter, config, docsService, repository } from "../bot/runtime";
import { buildDigestSummary } from "../services/digestFormatter";
import { buildScanDigestCard } from "../services/adaptiveCardFormatter";
import type { AppConfig, ConversationRegistration, ScanResult } from "../models";
import { CardFactory } from "botbuilder";

export interface DigestDeliveryPlan {
  action: "send" | "skip-empty" | "skip-circuit-breaker" | "skip-no-bot" | "skip-no-conversations";
  conversations: Array<{ conversation: ConversationRegistration; deliver: boolean; reason: string }>;
}

export function planDigestDelivery(
  scanResult: ScanResult,
  conversations: ConversationRegistration[],
  appConfig: Pick<AppConfig, "sendEmptyDigests" | "maxChangesPerDigest" | "digestCooldownHours" | "botAppId">,
  now = Date.now(),
): DigestDeliveryPlan {
  if (scanResult.changes.length === 0 && !appConfig.sendEmptyDigests) {
    return { action: "skip-empty", conversations: [] };
  }

  if (scanResult.changes.length > appConfig.maxChangesPerDigest) {
    return { action: "skip-circuit-breaker", conversations: [] };
  }

  if (!appConfig.botAppId) {
    return { action: "skip-no-bot", conversations: [] };
  }

  if (conversations.length === 0) {
    return { action: "skip-no-conversations", conversations: [] };
  }

  const cooldownMs = appConfig.digestCooldownHours * 60 * 60 * 1000;

  return {
    action: "send",
    conversations: conversations.map((conversation) => {
      if (conversation.lastDigestAt) {
        const lastSent = new Date(conversation.lastDigestAt).getTime();
        if (!Number.isNaN(lastSent) && now - lastSent < cooldownMs) {
          return { conversation, deliver: false, reason: "cooldown" };
        }
      }
      return { conversation, deliver: true, reason: "ok" };
    }),
  };
}

app.timer("dailyDigest", {
  schedule: config.digestSchedule,
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const scanResult = await docsService.scanNow();
    const conversations = await repository.listConversations();
    const plan = planDigestDelivery(scanResult, conversations, config);

    if (plan.action === "skip-empty") {
      context.log("No Marketplace documentation changes detected.");
      return;
    }

    if (plan.action === "skip-circuit-breaker") {
      context.warn(
        `Circuit breaker: scan produced ${scanResult.changes.length} changes (limit: ${config.maxChangesPerDigest}). ` +
        "Suppressing proactive digest. Run 'scan now' manually to review.",
      );
      return;
    }

    if (plan.action === "skip-no-bot") {
      context.warn("Skipping proactive digest because MicrosoftAppId is not configured.");
      return;
    }

    if (plan.action === "skip-no-conversations") {
      context.log("No registered Teams conversations found for daily digest delivery.");
      return;
    }

    const digestSummary = buildDigestSummary(scanResult.changes, scanResult.checkedAt);
    const digestCard = buildScanDigestCard(scanResult);

    for (const { conversation, deliver, reason } of plan.conversations) {
      if (!deliver) {
        context.log(
          `Skipping digest for ${conversation.id}: ${reason} (last sent ${conversation.lastDigestAt}).`,
        );
        continue;
      }

      try {
        await adapter.continueConversation(
          conversation.conversationReference,
          async (turnContext) => {
            await turnContext.sendActivity({
              summary: digestSummary,
              attachments: [CardFactory.adaptiveCard(digestCard)],
            });
          },
        );

        await repository.markDigestSent(conversation.id, scanResult.checkedAt);
      } catch (error) {
        context.error(
          `Failed to send digest to conversation ${conversation.id}`,
          error,
        );
      }
    }
  },
});


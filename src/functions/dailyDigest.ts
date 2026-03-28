import {
  app,
  type InvocationContext,
  type Timer,
} from "@azure/functions";

import { adapter, config, docsService, repository } from "../bot/runtime";
import { buildDigestSummary } from "../services/digestFormatter";
import { buildScanDigestCard } from "../services/adaptiveCardFormatter";
import { CardFactory } from "botbuilder";

app.timer("dailyDigest", {
  schedule: config.digestSchedule,
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const scanResult = await docsService.scanNow();

    if (scanResult.changes.length === 0 && !config.sendEmptyDigests) {
      context.log("No Marketplace documentation changes detected.");
      return;
    }

    // Circuit breaker: suppress digest if change count is abnormally high
    if (scanResult.changes.length > config.maxChangesPerDigest) {
      context.warn(
        `Circuit breaker: scan produced ${scanResult.changes.length} changes (limit: ${config.maxChangesPerDigest}). ` +
        "Suppressing proactive digest. Run 'scan now' manually to review.",
      );
      return;
    }

    if (!config.botAppId) {
      context.warn("Skipping proactive digest because MicrosoftAppId is not configured.");
      return;
    }

    const conversations = await repository.listConversations();
    if (conversations.length === 0) {
      context.log("No registered Teams conversations found for daily digest delivery.");
      return;
    }

    const cooldownMs = config.digestCooldownHours * 60 * 60 * 1000;
    const now = Date.now();

    const digestSummary = buildDigestSummary(scanResult.changes, scanResult.checkedAt);
    const digestCard = buildScanDigestCard(scanResult);

    for (const conversation of conversations) {
      // Cooldown: skip if last digest was sent too recently
      if (conversation.lastDigestAt) {
        const lastSent = new Date(conversation.lastDigestAt).getTime();
        if (!Number.isNaN(lastSent) && now - lastSent < cooldownMs) {
          context.log(
            `Skipping digest for ${conversation.id}: cooldown (last sent ${conversation.lastDigestAt}).`,
          );
          continue;
        }
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


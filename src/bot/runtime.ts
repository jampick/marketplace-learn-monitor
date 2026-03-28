import { getConfig } from "../config";
import { MarketplaceDocsService } from "../services/marketplaceDocsService";
import { MonitorStateRepository } from "../services/monitorStateRepository";
import { DirectTokenBotFrameworkAdapter } from "./directTokenBotFrameworkAdapter";
import { MarketplaceMonitorBot } from "./marketplaceMonitorBot";

export const config = getConfig();
export const repository = new MonitorStateRepository();
export const docsService = new MarketplaceDocsService(repository, config);

export const adapter = new DirectTokenBotFrameworkAdapter({
  appId: process.env.MicrosoftAppId ?? "",
  appPassword: process.env.MicrosoftAppPassword ?? "",
  channelAuthTenant: process.env.MicrosoftAppTenantId,
});
export const bot = new MarketplaceMonitorBot(docsService, repository);

adapter.onTurnError = async (context, error) => {
  console.error("Unhandled bot error:", error);
  const message = error instanceof Error ? error.message : String(error);

  const isDeliveryFailure =
    /Authorization has been denied for this request|A task was canceled/i.test(message);

  if (isDeliveryFailure) {
    console.error("Skipping bot error reply because channel delivery failed.");
    return;
  }

  try {
    await context.sendActivity(
      "The Marketplace doc monitor hit an unexpected error. Please try again in a moment.",
    );
  } catch (sendError) {
    console.error("Failed to send bot error message:", sendError);
  }
};


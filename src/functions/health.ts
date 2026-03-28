import {
  app,
  type HttpResponseInit,
} from "@azure/functions";

import { config, docsService, repository } from "../bot/runtime";
import { getAppVersion, getVersioningScheme } from "../version";

interface HealthDependencies {
  docsService: Pick<typeof docsService, "getStatus">;
  repository: Pick<typeof repository, "listConversations">;
  botConfigured: boolean;
  version: string;
}

export function createHealthHandler({
  docsService: healthDocsService = docsService,
  repository: healthRepository = repository,
  botConfigured = Boolean(config.botAppId),
  version = getAppVersion(),
}: Partial<HealthDependencies> = {}) {
  return async (): Promise<HttpResponseInit> => {
    const [status, conversations] = await Promise.all([
      healthDocsService.getStatus(),
      healthRepository.listConversations(),
    ]);

    return {
      status: 200,
      jsonBody: {
        ok: true,
        version,
        versionScheme: getVersioningScheme(),
        trackedPages: status.trackedCount,
        registeredConversations: conversations.length,
        lastDigestAt: status.lastDigestAt ?? null,
        botConfigured,
      },
    };
  };
}

export const healthHandler = createHealthHandler();

app.http("health", {
  route: "health",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: healthHandler,
});


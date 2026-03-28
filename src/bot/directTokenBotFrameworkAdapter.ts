import {
  type AppCredentials,
  JwtTokenValidation,
} from "botframework-connector";
import {
  BotFrameworkAdapter,
  type BotFrameworkAdapterSettings,
} from "botbuilder";

import { DirectTokenAppCredentials } from "./directTokenAppCredentials";

export class DirectTokenBotFrameworkAdapter extends BotFrameworkAdapter {
  constructor(settings: BotFrameworkAdapterSettings) {
    super(settings);

    const replacementCredentials = this.createDirectCredentials(
      settings.appId,
      settings.appPassword,
      settings.channelAuthTenant,
    );

    // BotFrameworkAdapter hardcodes MSAL-backed credentials. Replace them so both
    // proactive sends and turn-based replies use the direct client-credential flow.
    Object.defineProperty(this, "credentials", {
      value: replacementCredentials,
      configurable: true,
      writable: false,
    });
  }

  protected override async buildCredentials(
    appId: string,
    oAuthScope?: string,
  ): Promise<AppCredentials> {
    const appPassword = await this.credentialsProvider.getAppPassword(appId);
    if (typeof appPassword !== "string" || appPassword.length === 0) {
      throw new Error(
        `DirectTokenBotFrameworkAdapter.buildCredentials(): missing app password for ${appId}.`,
      );
    }

    return this.createDirectCredentials(
      appId,
      appPassword,
      this.settings.channelAuthTenant,
      oAuthScope,
    );
  }

  private createDirectCredentials(
    appId: string,
    appPassword: string,
    channelAuthTenant?: string,
    oAuthScope?: string,
  ): AppCredentials {
    return new DirectTokenAppCredentials(
      appId,
      appPassword,
      channelAuthTenant,
      oAuthScope,
      this.isGovernmentChannel(),
    );
  }

  private isGovernmentChannel(): boolean {
    return typeof this.settings.channelService === "string"
      && JwtTokenValidation.isGovernment(this.settings.channelService);
  }
}

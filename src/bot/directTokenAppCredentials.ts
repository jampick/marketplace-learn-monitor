import {
  AppCredentials,
  AuthenticationConstants,
  GovernmentConstants,
} from "botframework-connector";

interface TokenResponsePayload {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

export class DirectTokenAppCredentials extends AppCredentials {
  constructor(
    appId: string,
    private readonly appPassword: string,
    channelAuthTenant?: string,
    oAuthScope?: string,
    private readonly isGovernment = false,
  ) {
    super(appId, channelAuthTenant, oAuthScope);
  }

  protected GetToChannelFromBotLoginUrlPrefix(): string {
    return this.isGovernment
      ? GovernmentConstants.ToChannelFromBotLoginUrlPrefix
      : AuthenticationConstants.ToChannelFromBotLoginUrlPrefix;
  }

  protected GetToChannelFromBotOAuthScope(): string {
    return this.isGovernment
      ? GovernmentConstants.ToChannelFromBotOAuthScope
      : AuthenticationConstants.ToChannelFromBotOAuthScope;
  }

  protected GetDefaultChannelAuthTenant(): string {
    return this.isGovernment
      ? GovernmentConstants.DefaultChannelAuthTenant
      : AuthenticationConstants.DefaultChannelAuthTenant;
  }

  protected async refreshToken(): Promise<{ accessToken: string; expiresOn: Date }> {
    if (!this.appId || !this.appPassword) {
      throw new Error("DirectTokenAppCredentials.refreshToken(): missing bot credentials.");
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 15_000);

    try {
      const scope = this.oAuthScope.endsWith("/.default")
        ? this.oAuthScope
        : `${this.oAuthScope}/.default`;
      const response = await fetch(
        `${this.oAuthEndpoint}${AuthenticationConstants.ToChannelFromBotTokenEndpointPath}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: this.appId,
            client_secret: this.appPassword,
            scope,
            grant_type: "client_credentials",
          }),
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as TokenResponsePayload;

      if (!response.ok || typeof payload.access_token !== "string") {
        const details = payload.error_description ?? payload.error ?? response.statusText;
        throw new Error(
          `DirectTokenAppCredentials.refreshToken(): token request failed (${response.status}) ${details}`,
        );
      }

      const expiresInSeconds = Number(payload.expires_in ?? 3600);
      const expiresOn = new Date(Date.now() + expiresInSeconds * 1000);

      return {
        accessToken: payload.access_token,
        expiresOn,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("DirectTokenAppCredentials.refreshToken(): token request timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

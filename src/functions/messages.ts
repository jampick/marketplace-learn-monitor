import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import type { Request, Response } from "botbuilder/lib/interfaces";

import { adapter, bot } from "../bot/runtime";

class AzureFunctionsResponseAdapter implements Response {
  public socket = {};
  private statusCode = 200;
  private responseBody: unknown;
  private readonly responseHeaders = new Headers();

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  header(name: string, value: unknown): this {
    this.responseHeaders.set(name, String(value));
    return this;
  }

  send(body?: unknown): this {
    this.responseBody = body;
    return this;
  }

  end(body?: unknown): this {
    if (body !== undefined && this.responseBody === undefined) {
      this.responseBody = body;
    }

    return this;
  }

  toHttpResponse(): HttpResponseInit {
    const headers: Record<string, string> = {};
    this.responseHeaders.forEach((value, key) => {
      headers[key] = value;
    });

    if (this.responseBody === undefined) {
      return {
        status: this.statusCode,
        headers,
      };
    }

    if (typeof this.responseBody === "string") {
      return {
        status: this.statusCode,
        headers,
        body: this.responseBody,
      };
    }

    return {
      status: this.statusCode,
      headers,
      jsonBody: this.responseBody as Record<string, unknown>,
    };
  }
}

function toAdapterRequest(request: HttpRequest, body: Record<string, unknown>): Request {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    method: request.method,
    body,
    headers,
  };
}

interface MessagesDependencies {
  adapter: Pick<typeof adapter, "process">;
  bot: Pick<typeof bot, "run">;
}

export function createMessagesHandler({
  adapter: messagesAdapter = adapter,
  bot: messagesBot = bot,
}: Partial<MessagesDependencies> = {}) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const payload = await request.json();
      if (!payload || typeof payload !== "object" || !("type" in payload)) {
        return {
          status: 400,
          jsonBody: {
            error: "Expected a Bot Framework activity payload.",
          },
        };
      }

      const body = payload as Record<string, unknown>;
      const adapterRequest = toAdapterRequest(request, body);
      const adapterResponse = new AzureFunctionsResponseAdapter();

      await messagesAdapter.process(adapterRequest, adapterResponse, async (turnContext) => {
        await messagesBot.run(turnContext);
      });

      return adapterResponse.toHttpResponse();
    } catch (error) {
      context.error("Failed to process incoming Teams message", error);
      return {
        status: 500,
        jsonBody: {
          error: "Failed to process the incoming Teams activity.",
        },
      };
    }
  };
}

export const messagesHandler = createMessagesHandler();

app.http("messages", {
  route: "messages",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: messagesHandler,
});


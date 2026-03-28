import path from "path";

import type { AppConfig, AzureOpenAiConfig } from "./models";

const DEFAULT_MARKETPLACE_LANDING_URL =
  "https://learn.microsoft.com/en-us/partner-center/marketplace-offers/?accept=text/markdown";
const DEFAULT_PARTNER_CENTER_TOC_URL = "https://learn.microsoft.com/en-us/partner-center/toc.json";
const DEFAULT_ALLOWED_PREFIXES = ["https://learn.microsoft.com/en-us/partner-center/"];
const DEFAULT_DIGEST_SCHEDULE = "0 0 14 * * *";
const DEFAULT_STORAGE_CONTAINER = "marketplace-monitor";
const DEFAULT_STATE_DIRECTORY = ".data";
const DEFAULT_MAX_ANNOUNCEMENTS = 6;
const DEFAULT_MAX_CHANGES_PER_DIGEST = 15;
const DEFAULT_DIGEST_COOLDOWN_HOURS = 6;

let cachedConfig: AppConfig | undefined;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }

  return value.trim().toLowerCase() === "true";
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }

  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAzureOpenAiConfig(): AzureOpenAiConfig | undefined {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim();
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() ?? "2024-10-21";

  if (!endpoint || !apiKey || !deployment) {
    return undefined;
  }

  return {
    endpoint,
    apiKey,
    deployment,
    apiVersion,
  };
}

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    marketplaceLandingUrl:
      process.env.MARKETPLACE_LANDING_URL?.trim() ?? DEFAULT_MARKETPLACE_LANDING_URL,
    partnerCenterTocUrl:
      process.env.PARTNER_CENTER_TOC_URL?.trim() ?? DEFAULT_PARTNER_CENTER_TOC_URL,
    allowedDocPrefixes: parseList(process.env.ALLOWED_DOC_PREFIXES, DEFAULT_ALLOWED_PREFIXES),
    digestSchedule: process.env.DIGEST_SCHEDULE?.trim() ?? DEFAULT_DIGEST_SCHEDULE,
    sendEmptyDigests: parseBoolean(process.env.SEND_EMPTY_DIGESTS, false),
    maxAnnouncementPages: parseNumber(
      process.env.MAX_ANNOUNCEMENT_PAGES,
      DEFAULT_MAX_ANNOUNCEMENTS,
    ),
    storageContainer: process.env.MONITOR_STORAGE_CONTAINER?.trim() ?? DEFAULT_STORAGE_CONTAINER,
    stateDirectory: path.resolve(process.cwd(), process.env.STATE_DIRECTORY ?? DEFAULT_STATE_DIRECTORY),
    botAppId: process.env.MicrosoftAppId?.trim() ?? "",
    maxChangesPerDigest: parseNumber(process.env.MAX_CHANGES_PER_DIGEST, DEFAULT_MAX_CHANGES_PER_DIGEST),
    digestCooldownHours: parseNumber(process.env.DIGEST_COOLDOWN_HOURS, DEFAULT_DIGEST_COOLDOWN_HOURS),
    azureOpenAi: getAzureOpenAiConfig(),
  };

  return cachedConfig;
}


import type { ChangeHistoryQuery, ImpactAudience } from "../models";
import { toCanonicalLearnUrl } from "../utils/learn";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function isHistoryQuery(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("history") || normalized.includes("over time");
}

export function parseHistoryQuery(text: string, now = new Date()): ChangeHistoryQuery {
  const normalized = text.toLowerCase();
  const window = resolveWindow(normalized, now);

  return {
    url: extractRequestedUrl(text),
    audience: extractAudience(normalized),
    since: window.since.toISOString(),
    until: window.until.toISOString(),
  };
}

export function extractRequestedUrl(text: string): string | undefined {
  return parseRequestedUrl(text);
}

function extractAudience(text: string): ImpactAudience | undefined {
  if (text.includes("partner")) {
    return "partner";
  }

  if (text.includes("customer")) {
    return "customer";
  }

  return undefined;
}

function parseRequestedUrl(text: string): string | undefined {
  const hrefMatch = text.match(/href="(https?:\/\/[^"]+)"/i);
  if (hrefMatch) {
    try {
      return toCanonicalLearnUrl(hrefMatch[1]);
    } catch {
      return hrefMatch[1];
    }
  }

  const match = text.match(/https?:\/\/\S+/i);
  if (!match) {
    return undefined;
  }

  const rawUrl = match[0].replace(/[),]+$/, "");
  try {
    return toCanonicalLearnUrl(rawUrl);
  } catch {
    return rawUrl;
  }
}

function resolveWindow(text: string, now: Date): { since: Date; until: Date } {
  const betweenMatch = text.match(
    /\b(?:between|from)\s+(\d{4}-\d{2}-\d{2})\s+(?:and|to)\s+(\d{4}-\d{2}-\d{2})\b/i,
  );
  if (betweenMatch) {
    return {
      since: startOfDay(parseIsoDate(betweenMatch[1])),
      until: endOfDay(parseIsoDate(betweenMatch[2])),
    };
  }

  const sinceMatch = text.match(/\bsince\s+(\d{4}-\d{2}-\d{2})\b/i);
  const untilMatch = text.match(/\b(?:until|through)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (sinceMatch || untilMatch) {
    return {
      since: sinceMatch ? startOfDay(parseIsoDate(sinceMatch[1])) : new Date(now.getTime() - 30 * DAY_IN_MS),
      until: untilMatch ? endOfDay(parseIsoDate(untilMatch[1])) : now,
    };
  }

  const relativeMatch = text.match(/\b(?:last|past)\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
  if (relativeMatch) {
    return {
      since: subtractWindow(now, Number(relativeMatch[1]), relativeMatch[2]),
      until: now,
    };
  }

  if (text.includes("yesterday")) {
    const yesterday = new Date(now.getTime() - DAY_IN_MS);
    return {
      since: startOfDay(yesterday),
      until: endOfDay(yesterday),
    };
  }

  if (text.includes("today")) {
    return {
      since: startOfDay(now),
      until: now,
    };
  }

  if (text.includes("last week")) {
    return {
      since: new Date(now.getTime() - 7 * DAY_IN_MS),
      until: now,
    };
  }

  if (text.includes("last month")) {
    return {
      since: subtractWindow(now, 1, "month"),
      until: now,
    };
  }

  return {
    since: new Date(now.getTime() - 30 * DAY_IN_MS),
    until: now,
  };
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function subtractWindow(now: Date, amount: number, unit: string): Date {
  const copy = new Date(now);

  switch (unit) {
    case "day":
    case "days":
      copy.setTime(copy.getTime() - amount * DAY_IN_MS);
      return copy;
    case "week":
    case "weeks":
      copy.setTime(copy.getTime() - amount * 7 * DAY_IN_MS);
      return copy;
    case "month":
    case "months":
      copy.setUTCMonth(copy.getUTCMonth() - amount);
      return copy;
    default:
      return new Date(now.getTime() - 30 * DAY_IN_MS);
  }
}

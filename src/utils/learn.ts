import { URL } from "url";

const MARKDOWN_ACCEPT_SUFFIX = "?accept=text/markdown";

export function toCanonicalLearnUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function toMarkdownUrl(rawUrl: string): string {
  const canonical = new URL(toCanonicalLearnUrl(rawUrl));
  canonical.search = new URLSearchParams({ accept: "text/markdown" }).toString();
  return canonical.toString();
}

export function normalizeLearnUrl(rawUrl: string, baseUrl: string): string {
  const resolved = new URL(rawUrl, baseUrl).toString();
  return toCanonicalLearnUrl(resolved);
}

export function extractMarkdownLinks(markdownBody: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const linkExpression = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  let match: RegExpExecArray | null = linkExpression.exec(markdownBody);
  while (match) {
    const rawHref = match[1]?.trim();
    if (rawHref && !rawHref.startsWith("#") && !rawHref.startsWith("mailto:")) {
      try {
        links.add(normalizeLearnUrl(rawHref, baseUrl));
      } catch {
        // Ignore malformed links from the page.
      }
    }

    match = linkExpression.exec(markdownBody);
  }

  return [...links];
}

export function trimLineForDigest(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[-*#>\s]+/, "").trim();
}

export function createDocId(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function isMarkdownAcceptUrl(url: string): boolean {
  return url.endsWith(MARKDOWN_ACCEPT_SUFFIX);
}

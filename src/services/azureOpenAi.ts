import type { ChangeCategory, ImpactAudience, AzureOpenAiConfig } from "../models";

interface AzureOpenAiResult {
  summary: string;
  whyItMatters: string;
  audience: ImpactAudience;
  categories: ChangeCategory[];
}

const VALID_AUDIENCES = new Set<ImpactAudience>(["partner", "customer", "both"]);
const VALID_CATEGORIES = new Set<ChangeCategory>([
  "account",
  "publishing",
  "pricing",
  "billing",
  "apis",
  "analytics",
  "support",
  "announcements",
  "other",
]);

export async function trySummarizeWithAzureOpenAi(
  config: AzureOpenAiConfig | undefined,
  prompt: string,
): Promise<AzureOpenAiResult | undefined> {
  if (!config) {
    return undefined;
  }

  const endpoint = config.endpoint.replace(/\/$/, "");
  const url =
    `${endpoint}/openai/deployments/${config.deployment}/chat/completions` +
    `?api-version=${encodeURIComponent(config.apiVersion)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are summarizing Microsoft Marketplace documentation changes. Return compact JSON only.",
        },
        {
          role: "user",
          content:
            `${prompt}\n\nReturn JSON with keys: summary, whyItMatters, audience, categories.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Azure OpenAI request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return undefined;
  }

  const parsed = JSON.parse(content) as Partial<AzureOpenAiResult>;
  const audience = VALID_AUDIENCES.has(parsed.audience as ImpactAudience)
    ? (parsed.audience as ImpactAudience)
    : "partner";
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.filter(
        (value): value is ChangeCategory =>
          typeof value === "string" && VALID_CATEGORIES.has(value as ChangeCategory),
      )
    : [];

  if (!parsed.summary || !parsed.whyItMatters) {
    return undefined;
  }

  return {
    summary: parsed.summary.trim(),
    whyItMatters: parsed.whyItMatters.trim(),
    audience,
    categories: categories.length > 0 ? categories : ["other"],
  };
}


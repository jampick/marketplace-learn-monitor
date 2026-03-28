import type { ConversationReference } from "botbuilder";

export type ImpactAudience = "partner" | "customer" | "both";
export type ChangeSeverity = "cosmetic" | "minor" | "major";
export type ChangeCategory =
  | "account"
  | "publishing"
  | "pricing"
  | "billing"
  | "apis"
  | "analytics"
  | "support"
  | "announcements"
  | "other";

export interface MonitoredDocument {
  docId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  summary?: string;
  sourcePath?: string;
  gitCommitId?: string;
  updatedAt?: string;
  fetchedAt: string;
  bodyHash: string;
  body: string;
  headings: string[];
}

export interface StoredDocumentIndexEntry {
  docId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  summary?: string;
  sourcePath?: string;
  gitCommitId?: string;
  updatedAt?: string;
  fetchedAt: string;
  bodyHash: string;
  snapshotPath: string;
}

export type StoredDocumentIndex = Record<string, StoredDocumentIndexEntry>;

export interface ChangeHighlight {
  type: "added" | "removed" | "meta";
  text: string;
}

export interface ChangeSummary {
  id: string;
  docId: string;
  title: string;
  canonicalUrl: string;
  sourcePath?: string;
  updatedAt?: string;
  gitCommitId?: string;
  audience: ImpactAudience;
  severity: ChangeSeverity;
  categories: ChangeCategory[];
  summary: string;
  whyItMatters: string;
  highlights: ChangeHighlight[];
  detectedAt: string;
  backfilled?: boolean;
}

export interface DigestHistoryItem {
  id: string;
  createdAt: string;
  summary: string;
  changes: ChangeSummary[];
}

export interface ChangeHistoryQuery {
  since: string;
  until: string;
  url?: string;
  audience?: ImpactAudience;
}

export interface ChangeHistoryResult {
  since: string;
  until: string;
  url?: string;
  audience?: ImpactAudience;
  matchedUrls: string[];
  changes: ChangeSummary[];
}

export interface BackfillResult {
  since: string;
  until: string;
  url?: string;
  scannedUrls: number;
  createdDigests: number;
  createdChanges: number;
  skippedCount: number;
}

export interface ObservedDiffExcerpt {
  oldText?: string;
  newText?: string;
}

export interface ObservedDiffResult {
  canonicalUrl: string;
  change: ChangeSummary;
  previousFetchedAt: string;
  currentFetchedAt: string;
  previousUpdatedAt?: string;
  currentUpdatedAt?: string;
  excerpts: ObservedDiffExcerpt[];
}

export interface ConversationRegistration {
  id: string;
  scope: "personal" | "groupChat" | "team" | "unknown";
  conversationReference: Partial<ConversationReference>;
  addedAt: string;
  lastSeenAt: string;
  lastDigestAt?: string;
  tenantId?: string;
  conversationId?: string;
  conversationName?: string;
  userId?: string;
  userName?: string;
  aadObjectId?: string;
}

export interface ScanResult {
  checkedAt: string;
  trackedUrls: string[];
  changes: ChangeSummary[];
  summary: string;
  documentIndex: StoredDocumentIndex;
}

export interface AzureOpenAiConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export interface AppConfig {
  marketplaceLandingUrl: string;
  partnerCenterTocUrl: string;
  allowedDocPrefixes: string[];
  digestSchedule: string;
  sendEmptyDigests: boolean;
  maxAnnouncementPages: number;
  storageContainer: string;
  stateDirectory: string;
  botAppId: string;
  azureOpenAi?: AzureOpenAiConfig;
}


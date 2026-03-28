import { createSha256 } from "../utils/hash";
import type {
  ConversationRegistration,
  DigestHistoryItem,
  MonitoredDocument,
  StoredDocumentIndex,
} from "../models";
import { StateStore } from "./stateStore";

const DOCUMENT_INDEX_PATH = "state/documents.json";
const CONVERSATIONS_PATH = "state/conversations.json";
const DIGEST_HISTORY_PATH = "state/digests.json";

export class MonitorStateRepository {
  constructor(private readonly store = new StateStore()) {}

  async loadDocumentIndex(): Promise<StoredDocumentIndex> {
    return this.store.readJson<StoredDocumentIndex>(DOCUMENT_INDEX_PATH, {});
  }

  async saveDocumentIndex(index: StoredDocumentIndex): Promise<void> {
    await this.store.writeJson(DOCUMENT_INDEX_PATH, index);
  }

  async loadSnapshot(snapshotPath: string | undefined): Promise<MonitoredDocument | undefined> {
    if (!snapshotPath) {
      return undefined;
    }

    return this.store.readJson<MonitoredDocument | undefined>(snapshotPath, undefined);
  }

  async saveSnapshot(document: MonitoredDocument): Promise<string> {
    const timestamp = document.fetchedAt.replaceAll(":", "-");
    const historicalPath = `snapshots/${document.docId}/${timestamp}.json`;
    const latestPath = `snapshots/${document.docId}/latest.json`;

    await this.store.writeJson(historicalPath, document);
    await this.store.writeJson(latestPath, document);

    return latestPath;
  }

  async listSnapshots(docId: string): Promise<MonitoredDocument[]> {
    const snapshotPaths = await this.store.listPaths(`snapshots/${docId}/`);
    const historicalPaths = snapshotPaths.filter(
      (snapshotPath) => snapshotPath.endsWith(".json") && !snapshotPath.endsWith("/latest.json"),
    );
    const snapshots = await Promise.all(
      historicalPaths.map((snapshotPath) =>
        this.store.readJson<MonitoredDocument | undefined>(snapshotPath, undefined),
      ),
    );

    return snapshots
      .filter((snapshot): snapshot is MonitoredDocument => Boolean(snapshot))
      .sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt));
  }

  async listConversations(): Promise<ConversationRegistration[]> {
    const conversations = await this.store.readJson<Record<string, ConversationRegistration>>(
      CONVERSATIONS_PATH,
      {},
    );
    return Object.values(conversations).sort((left, right) =>
      left.id.localeCompare(right.id, "en", { sensitivity: "base" }),
    );
  }

  async saveConversation(conversation: ConversationRegistration): Promise<void> {
    const current = await this.store.readJson<Record<string, ConversationRegistration>>(
      CONVERSATIONS_PATH,
      {},
    );

    current[conversation.id] = conversation;
    await this.store.writeJson(CONVERSATIONS_PATH, current);
  }

  async markDigestSent(conversationId: string, sentAt: string): Promise<void> {
    const conversations = await this.store.readJson<Record<string, ConversationRegistration>>(
      CONVERSATIONS_PATH,
      {},
    );
    const existing = conversations[conversationId];
    if (!existing) {
      return;
    }

    existing.lastDigestAt = sentAt;
    await this.store.writeJson(CONVERSATIONS_PATH, conversations);
  }

  async loadDigestHistory(limit?: number): Promise<DigestHistoryItem[]> {
    const history = await this.store.readJson<DigestHistoryItem[]>(DIGEST_HISTORY_PATH, []);
    return typeof limit === "number" ? history.slice(0, limit) : history;
  }

  async saveDigest(digest: DigestHistoryItem, maxItems = 180): Promise<void> {
    const current = await this.store.readJson<DigestHistoryItem[]>(DIGEST_HISTORY_PATH, []);
    const next = [digest, ...current.filter((item) => item.id !== digest.id)].slice(0, maxItems);
    await this.store.writeJson(DIGEST_HISTORY_PATH, next);
  }

  createDigestId(seed: string): string {
    return createSha256(seed).slice(0, 24);
  }
}


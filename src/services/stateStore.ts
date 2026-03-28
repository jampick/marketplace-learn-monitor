import fs from "fs/promises";
import path from "path";

import { BlobServiceClient } from "@azure/storage-blob";

import { getConfig } from "../config";

export class StateStore {
  private readonly blobServiceClient?: BlobServiceClient;
  private containerReady?: Promise<void>;

  constructor(
    private readonly containerName = getConfig().storageContainer,
    private readonly localStateDirectory = getConfig().stateDirectory,
  ) {
    const connectionString = process.env.AzureWebJobsStorage?.trim();
    if (connectionString && connectionString !== "UseDevelopmentStorage=true") {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    }
  }

  async readJson<T>(blobPath: string, fallback: T): Promise<T> {
    const payload = await this.readText(blobPath);
    if (!payload) {
      return fallback;
    }

    try {
      return JSON.parse(payload) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson<T>(blobPath: string, value: T): Promise<void> {
    await this.writeText(blobPath, JSON.stringify(value, null, 2));
  }

  async readText(blobPath: string): Promise<string | undefined> {
    if (this.blobServiceClient) {
      await this.ensureContainer();
      const blobClient = this.blobServiceClient.getContainerClient(this.containerName).getBlobClient(blobPath);
      const exists = await blobClient.exists();
      if (!exists) {
        return undefined;
      }

      const response = await blobClient.download();
      return (await this.streamToString(response.readableStreamBody)) ?? undefined;
    }

    const filePath = this.resolveLocalPath(blobPath);
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return undefined;
    }
  }

  async writeText(blobPath: string, value: string): Promise<void> {
    if (this.blobServiceClient) {
      await this.ensureContainer();
      const blobClient = this.blobServiceClient.getContainerClient(this.containerName).getBlockBlobClient(blobPath);
      await blobClient.upload(value, Buffer.byteLength(value), {
        blobHTTPHeaders: {
          blobContentType: "application/json; charset=utf-8",
        },
      });
      return;
    }

    const filePath = this.resolveLocalPath(blobPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, value, "utf8");
  }

  async listPaths(prefix: string): Promise<string[]> {
    if (this.blobServiceClient) {
      await this.ensureContainer();
      const paths: string[] = [];
      for await (const blob of this.blobServiceClient
        .getContainerClient(this.containerName)
        .listBlobsFlat({ prefix })) {
        paths.push(blob.name);
      }

      return paths.sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
    }

    const directoryPath = this.resolveLocalPath(prefix);
    try {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const paths = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(directoryPath, entry.name);
          if (entry.isDirectory()) {
            return this.listLocalPaths(entryPath);
          }

          return [this.toBlobPath(entryPath)];
        }),
      );

      return paths
        .flat()
        .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
    } catch {
      return [];
    }
  }

  private resolveLocalPath(blobPath: string): string {
    return path.join(this.localStateDirectory, blobPath.replaceAll("/", path.sep));
  }

  private async listLocalPaths(directoryPath: string): Promise<string[]> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const paths = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          return this.listLocalPaths(entryPath);
        }

        return [this.toBlobPath(entryPath)];
      }),
    );

    return paths.flat();
  }

  private toBlobPath(filePath: string): string {
    return path.relative(this.localStateDirectory, filePath).split(path.sep).join("/");
  }

  private async ensureContainer(): Promise<void> {
    if (!this.blobServiceClient) {
      return;
    }

    if (!this.containerReady) {
      this.containerReady = this.blobServiceClient
        .getContainerClient(this.containerName)
        .createIfNotExists()
        .then(() => undefined);
    }

    await this.containerReady;
  }

  private async streamToString(
    readableStream: NodeJS.ReadableStream | undefined,
  ): Promise<string | undefined> {
    if (!readableStream) {
      return undefined;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of readableStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString("utf8");
  }
}


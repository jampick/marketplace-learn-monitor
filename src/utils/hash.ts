import crypto from "crypto";

export function createSha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}


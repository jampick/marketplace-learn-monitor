import fs from "fs";
import path from "path";

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

let cachedVersion: string | undefined;

export function getAppVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };

  cachedVersion =
    typeof packageJson.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : "0.0.0";

  return cachedVersion;
}

export function isSemVer(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

export function getVersioningScheme(): "semver" {
  return "semver";
}


import { createHash } from "node:crypto";

/**
 * @typedef {{
 *   submodule: string,
 *   path?: string,
 *   version: string,
 * }} RegistryEntry
 *
 * @typedef {{
 *   submodule: string,
 *   path?: string,
 *   version: string,
 *   source_repository: string,
 *   source_revision: string,
 *   published_at: string,
 * }} Addition
 *
 * @typedef {{
 *   id: string,
 *   version: string,
 *   schema_version: number,
 *   wasm_api_version: string | null,
 *   source_repository: string,
 *   source_revision: string,
 *   archive_url: string,
 *   archive_size: number,
 *   archive_sha256: string,
 * }} PackageRecord
 */

/** @param {string | Uint8Array} value */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Ensure the fork branch is an exact upstream snapshot plus declared additions.
 *
 * @param {Record<string, RegistryEntry>} current
 * @param {Record<string, RegistryEntry>} upstream
 * @param {Record<string, Addition>} additions
 * @param {Record<string, {url: string, revision: string}>} sources
 * @param {Record<string, {url: string, revision: string}>} upstreamSources
 */
export function validateRegistryDelta(
  current,
  upstream,
  additions,
  sources,
  upstreamSources,
) {
  const upstreamIds = Object.keys(upstream).sort();
  const currentIds = Object.keys(current).sort();
  const additionIds = Object.keys(additions).sort();

  for (const id of upstreamIds) {
    if (!current[id]) {
      throw new Error(`RP registry dropped upstream extension "${id}".`);
    }

    if (JSON.stringify(current[id]) !== JSON.stringify(upstream[id])) {
      throw new Error(`RP registry modified upstream extension "${id}".`);
    }

    const submodule = upstream[id]?.submodule;
    const source = submodule ? sources[submodule] : undefined;
    const upstreamSource = submodule ? upstreamSources[submodule] : undefined;
    if (
      !source ||
      !upstreamSource ||
      source.url !== upstreamSource.url ||
      source.revision !== upstreamSource.revision
    ) {
      throw new Error(`RP registry modified upstream source for "${id}".`);
    }
  }

  const unexpectedIds = currentIds.filter(
    (id) => !upstream[id] && !additions[id],
  );
  if (unexpectedIds.length > 0) {
    throw new Error(
      `RP registry contains undeclared additions: ${unexpectedIds.join(", ")}.`,
    );
  }

  for (const id of additionIds) {
    const expected = additions[id];
    const actual = current[id];
    if (!expected) {
      throw new Error(`Missing configuration for RP addition "${id}".`);
    }
    if (!actual) {
      throw new Error(`RP registry is missing declared addition "${id}".`);
    }

    const fields = [
      ["submodule", expected.submodule, actual.submodule],
      ["path", expected.path, actual.path],
      ["version", expected.version, actual.version],
    ];
    for (const [field, expectedValue, actualValue] of fields) {
      if (expectedValue !== actualValue) {
        throw new Error(
          `RP addition "${id}" has ${field}=${JSON.stringify(actualValue)}; expected ${JSON.stringify(expectedValue)}.`,
        );
      }
    }

    const source = sources[actual.submodule];
    if (!source) {
      throw new Error(`RP addition "${id}" has no Git submodule source.`);
    }
    if (source.url !== expected.source_repository) {
      throw new Error(
        `RP addition "${id}" source is ${source.url}; expected ${expected.source_repository}.`,
      );
    }
    if (source.revision !== expected.source_revision) {
      throw new Error(
        `RP addition "${id}" revision is ${source.revision}; expected ${expected.source_revision}.`,
      );
    }
  }

  if (currentIds.length !== upstreamIds.length + additionIds.length) {
    throw new Error(
      `RP registry has ${currentIds.length} entries; expected ${upstreamIds.length + additionIds.length}.`,
    );
  }
}

/**
 * @param {PackageRecord[]} packages
 * @param {string[]} extensionIds
 */
export function validatePackageRecords(packages, extensionIds) {
  const expected = new Set(extensionIds);
  const seen = new Set();

  for (const record of packages) {
    if (!expected.has(record.id)) {
      throw new Error(`Package record has unknown extension "${record.id}".`);
    }
    if (seen.has(record.id)) {
      throw new Error(`Package record is duplicated for "${record.id}".`);
    }
    seen.add(record.id);

    if (!/^[a-f0-9]{40}$/.test(record.source_revision)) {
      throw new Error(`Package "${record.id}" has an invalid source revision.`);
    }
    if (!/^[a-f0-9]{64}$/.test(record.archive_sha256)) {
      throw new Error(`Package "${record.id}" has an invalid SHA-256.`);
    }
    if (
      !Number.isSafeInteger(record.archive_size) ||
      record.archive_size <= 0
    ) {
      throw new Error(`Package "${record.id}" has an invalid archive size.`);
    }
    if (new URL(record.archive_url).protocol !== "https:") {
      throw new Error(`Package "${record.id}" does not use HTTPS.`);
    }
  }

  const missing = extensionIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`Missing package records: ${missing.join(", ")}.`);
  }
}

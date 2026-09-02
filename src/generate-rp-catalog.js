import fs from "node:fs/promises";
import path from "node:path";
import toml from "@iarna/toml";
import { readSubmoduleSources } from "./lib/git.js";
import { exec } from "./lib/process.js";
import {
  sha256,
  validatePackageRecords,
  validateRegistryDelta,
} from "./lib/rp-catalog.js";

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   version: string,
 *   description?: string,
 *   authors: string[],
 *   repository: string,
 *   schema_version?: number,
 *   wasm_api_version?: string | null,
 *   provides?: string[],
 *   published_at: string,
 *   download_count: number,
 * }} ExtensionMetadata
 *
 * @typedef {{
 *   schema_version: number,
 *   channel: string,
 *   label: string,
 *   base_url: string,
 *   upstream_repository: string,
 *   fork_repository: string,
 *   upstream_api_url: string,
 *   upstream_archive_host: string,
 *   additions: Record<string, import("./lib/rp-catalog.js").Addition>,
 * }} CatalogConfig
 *
 * @typedef {{
 *   packages: import("./lib/rp-catalog.js").PackageRecord[],
 * }} PreviousCatalog
 */

const upstreamRevision = requiredEnv("UPSTREAM_REVISION");
const forkRevision = requiredEnv("FORK_REVISION");
const outputRoot = process.env["RP_CATALOG_OUTPUT"] ?? "public/rp-catalog/v1";
const pigmentsArchive =
  process.env["PIGMENTS_ARCHIVE"] ?? "output/archive.tar.gz";
const pigmentsManifest =
  process.env["PIGMENTS_MANIFEST"] ?? "output/manifest.json";
const currentCatalogUrl = process.env["CURRENT_CATALOG_URL"];
const concurrency = Number.parseInt(
  process.env["RP_CATALOG_CONCURRENCY"] ?? "8",
  10,
);

/** @type {CatalogConfig} */
const config = JSON.parse(await fs.readFile("rp-catalog.config.json", "utf8"));
/** @type {Record<string, import("./lib/rp-catalog.js").RegistryEntry>} */
const current =
  /** @type {Record<string, import("./lib/rp-catalog.js").RegistryEntry>} */ (
    /** @type {unknown} */ (
      toml.parse(await fs.readFile("extensions.toml", "utf8"))
    )
  );
const { stdout: upstreamToml } = await exec("git", [
  "show",
  `${upstreamRevision}:extensions.toml`,
]);
/** @type {Record<string, import("./lib/rp-catalog.js").RegistryEntry>} */
const upstream =
  /** @type {Record<string, import("./lib/rp-catalog.js").RegistryEntry>} */ (
    /** @type {unknown} */ (toml.parse(upstreamToml))
  );
const sources = await readSubmoduleSources();
const upstreamSources = await readSubmoduleSources(upstreamRevision);
validateRegistryDelta(
  current,
  upstream,
  config.additions,
  sources,
  upstreamSources,
);

const previous = await fetchPreviousCatalog(currentCatalogUrl);
const previousPackages = new Map(
  (previous?.packages ?? []).map((record) => [
    `${record.id}@${record.version}`,
    record,
  ]),
);

const additionManifests = await readAdditionManifests();
const extensionIds = Object.keys(current).sort();
const results = await mapConcurrent(extensionIds, concurrency, async (id) => {
  const registryEntry = current[id];
  if (!registryEntry) {
    throw new Error(`Missing registry entry for ${id}.`);
  }
  const source = sources[registryEntry.submodule];
  if (!source) {
    throw new Error(`Missing source for ${id}.`);
  }

  const addition = config.additions[id];
  const versions = addition
    ? [additionManifests[id]]
    : await fetchJson(
        `${config.upstream_api_url}/extensions/${encodeURIComponent(id)}`,
      ).then(
        /** @param {{data: ExtensionMetadata[]}} response */ (response) =>
          response.data,
      );
  const metadata =
    versions.find(
      /** @param {any} version */ (version) =>
        version.version === registryEntry.version,
    ) ?? null;
  if (!metadata) {
    throw new Error(
      `Official registry has no ${id}@${registryEntry.version} metadata.`,
    );
  }

  const archiveUrl = addition
    ? `${config.base_url}/extensions/${id}/${registryEntry.version}/archive.tar.gz`
    : `${config.upstream_api_url}/extensions/${encodeURIComponent(id)}/${encodeURIComponent(registryEntry.version)}/download`;
  const previousPackage = previousPackages.get(
    `${id}@${registryEntry.version}`,
  );

  let archive;
  if (
    previousPackage?.source_revision === source.revision &&
    previousPackage?.archive_url === archiveUrl &&
    typeof previousPackage?.archive_sha256 === "string" &&
    Number.isSafeInteger(previousPackage?.archive_size)
  ) {
    archive = {
      size: previousPackage.archive_size,
      digest: previousPackage.archive_sha256,
    };
  } else if (addition) {
    const bytes = await fs.readFile(pigmentsArchive);
    archive = { size: bytes.byteLength, digest: sha256(bytes) };
  } else {
    archive = await fetchArchiveIntegrity(archiveUrl);
  }

  return {
    metadata,
    versions,
    package: {
      id,
      version: registryEntry.version,
      schema_version: metadata.schema_version ?? 0,
      wasm_api_version: metadata.wasm_api_version ?? null,
      source_repository: source.url,
      source_revision: source.revision,
      archive_url: archiveUrl,
      archive_size: archive.size,
      archive_sha256: archive.digest,
    },
  };
});

const packages = results.map((result) => result.package);
validatePackageRecords(packages, extensionIds);

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });
for (const [id, addition] of Object.entries(config.additions)) {
  const target = path.join(
    outputRoot,
    "extensions",
    id,
    addition.version,
    "archive.tar.gz",
  );
  await fs.mkdir(path.dirname(target), { recursive: true });

  const previousPackage = previousPackages.get(`${id}@${addition.version}`);
  if (
    previousPackage?.source_revision === addition.source_revision &&
    previousPackage?.archive_sha256 ===
      packages.find((record) => record.id === id)?.archive_sha256
  ) {
    const response = await fetchWithRetry(previousPackage.archive_url);
    const finalHost = new URL(response.url).hostname;
    if (finalHost !== "jonathonrp.github.io") {
      throw new Error(`Unexpected cached RP archive host: ${finalHost}.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength !== previousPackage.archive_size ||
      sha256(bytes) !== previousPackage.archive_sha256
    ) {
      throw new Error(`Cached RP archive integrity failed for ${id}.`);
    }
    await fs.writeFile(target, bytes);
  } else {
    await fs.copyFile(pigmentsArchive, target);
  }
}

/** @type {Record<string, any[]>} */
const versions = {};
for (const [index, id] of extensionIds.entries()) {
  const result = results[index];
  if (!result) throw new Error(`Missing generated result for ${id}.`);
  versions[id] = result.versions;
}

const catalog = {
  schema_version: config.schema_version,
  channel: config.channel,
  label: config.label,
  generated_at: new Date().toISOString(),
  source: {
    fork_repository: config.fork_repository,
    fork_revision: forkRevision,
    upstream_repository: config.upstream_repository,
    upstream_revision: upstreamRevision,
  },
  integrity: {
    catalog_digest_algorithm: "sha256",
    catalog_digest_url: `${config.base_url}/catalog.json.sha256`,
    allowed_archive_hosts: [
      "api.zed.dev",
      config.upstream_archive_host,
      "jonathonrp.github.io",
    ],
  },
  entry_count: extensionIds.length,
  upstream_entry_count: Object.keys(upstream).length,
  additions: Object.entries(config.additions).map(([id, addition]) => ({
    id,
    version: addition.version,
    source_repository: addition.source_repository,
    source_revision: addition.source_revision,
  })),
  data: results.map((result) => result.metadata),
  versions,
  packages,
};

const catalogJson = `${JSON.stringify(catalog, null, 2)}\n`;
const catalogDigest = sha256(catalogJson);
await Promise.all([
  fs.writeFile(path.join(outputRoot, "catalog.json"), catalogJson),
  fs.writeFile(
    path.join(outputRoot, "catalog.json.sha256"),
    `${catalogDigest}  catalog.json\n`,
  ),
  fs.copyFile("rp-catalog.schema.json", path.join(outputRoot, "schema.json")),
  fs.writeFile(
    path.join(outputRoot, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>RP Extensions</title><h1>RP Extensions</h1><p><a href="catalog.json">Catalog v1</a></p>\n',
  ),
]);

console.log(
  `Generated ${extensionIds.length} entries (${Object.keys(upstream).length} upstream + ${Object.keys(config.additions).length} RP) with catalog SHA-256 ${catalogDigest}.`,
);

async function readAdditionManifests() {
  const manifest = JSON.parse(await fs.readFile(pigmentsManifest, "utf8"));
  const firstAddition = Object.entries(config.additions)[0];
  if (!firstAddition) {
    throw new Error("Catalog must declare an RP addition.");
  }
  const [id, addition] = firstAddition;
  if (manifest.version !== addition.version) {
    throw new Error("Packaged RP addition does not match catalog config.");
  }
  return {
    [id]: {
      id,
      ...manifest,
      schema_version: manifest.schema_version ?? 0,
      wasm_api_version: manifest.wasm_api_version ?? null,
      provides: manifest.provides ?? [],
      published_at: addition.published_at,
      download_count: 0,
    },
  };
}

/**
 * @param {string | undefined} url
 * @returns {Promise<PreviousCatalog | null>}
 */
async function fetchPreviousCatalog(url) {
  if (!url) return null;
  try {
    return await fetchJson(url);
  } catch (error) {
    console.warn(`No reusable catalog at ${url}: ${error}`);
    return null;
  }
}

/** @param {string} url */
async function fetchArchiveIntegrity(url) {
  const response = await fetchWithRetry(url);
  const finalHost = new URL(response.url).hostname;
  if (finalHost !== config.upstream_archive_host) {
    throw new Error(`Unexpected upstream archive host: ${finalHost}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { size: bytes.byteLength, digest: sha256(bytes) };
}

/**
 * @template T
 * @param {string} url
 * @returns {Promise<T>}
 */
async function fetchJson(url) {
  const response = await fetchWithRetry(url);
  return /** @type {Promise<T>} */ (response.json());
}

/** @param {string} url */
async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "JonathonRP/extensions RP catalog" },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError}`);
}

/**
 * @template T, U
 * @param {T[]} values
 * @param {number} limit
 * @param {(value: T) => Promise<U>} operation
 */
async function mapConcurrent(values, limit, operation) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("RP_CATALOG_CONCURRENCY must be a positive integer.");
  }
  const results = /** @type {U[]} */ (new Array(values.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        const value = values[index];
        if (value === undefined) {
          throw new Error(`Missing value at index ${index}.`);
        }
        results[index] = await operation(value);
      }
    }),
  );
  return results;
}

/** @param {string} name */
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

import toml from "@iarna/toml";
import fs from "node:fs/promises";
import { readSubmoduleSources } from "./lib/git.js";
import { exec } from "./lib/process.js";
import { validateRegistryDelta } from "./lib/rp-catalog.js";

const upstreamRevision = process.env["UPSTREAM_REVISION"];
if (!upstreamRevision) {
  throw new Error("UPSTREAM_REVISION is required.");
}

/** @type {{additions: Record<string, import("./lib/rp-catalog.js").Addition>}} */
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
console.log(
  `Validated ${Object.keys(upstream).length} upstream entries and ${Object.keys(config.additions).length} RP addition(s).`,
);

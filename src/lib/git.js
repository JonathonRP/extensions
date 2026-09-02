import gitSubmodules from "git-submodule-js";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "./process.js";

/** @param {string} path */
export async function checkoutGitSubmodule(path) {
  console.log(`Checking out Git submodule at '${path}'`);

  await exec("git", ["submodule", "update", "--init", "--depth", "1", path]);
}

/**
 * @param {string} name
 * @param {string} repositoryUrl
 * @param {string} commitSha
 */
export async function checkoutGitRepo(name, repositoryUrl, commitSha) {
  const repoPath = await fs.mkdtemp(
    path.join("build", `${name}-${commitSha}.repo`),
  );
  const processOptions = {
    cwd: repoPath,
  };

  await exec("git", ["init"], processOptions);
  await exec("git", ["remote", "add", "origin", repositoryUrl], processOptions);
  await exec(
    "git",
    ["fetch", "--depth", "1", "origin", commitSha],
    processOptions,
  );
  await exec("git", ["checkout", commitSha], processOptions);
  return repoPath;
}

/** @param {string} path */
export async function readGitmodules(path) {
  const gitmodulesContent = await fs.readFile(path, "utf-8");

  return gitSubmodules.deserialize(gitmodulesContent);
}

/** @param {string} [ref] */
export async function readGitlinkRevisions(ref = "HEAD") {
  const { stdout } = await exec("git", ["ls-tree", "-r", ref, "extensions"]);
  /** @type {Record<string, string>} */
  const revisions = {};
  for (const line of stdout.split("\n")) {
    const match = line.match(
      /^160000 commit ([a-f0-9]{40})\t(extensions\/.+)$/,
    );
    if (match?.[1] && match[2]) {
      revisions[match[2]] = match[1];
    }
  }
  return revisions;
}

/** @param {string} [ref] */
export async function readSubmoduleSources(ref = "HEAD") {
  const { stdout } = await exec("git", ["show", `${ref}:.gitmodules`]);
  const gitmodules = gitSubmodules.deserialize(stdout);
  const revisions = await readGitlinkRevisions(ref);
  /** @type {Record<string, {url: string, revision: string}>} */
  const sources = {};

  for (const entry of Object.values(gitmodules)) {
    const submodulePath = entry["path"];
    const submoduleUrl = entry["url"];
    if (!submodulePath || !submoduleUrl) continue;
    const revision = revisions[submodulePath];
    if (!revision) {
      throw new Error(`Missing Git revision for submodule ${submodulePath}.`);
    }
    sources[submodulePath] = { url: submoduleUrl, revision };
  }

  return sources;
}

/** @param {string} path */
export async function sortGitmodules(path) {
  const gitmodules = await readGitmodules(path);

  const submoduleNames = Object.keys(gitmodules);
  submoduleNames.sort();

  /** @type {import('git-submodule-js').Submodule} */
  const sortedGitmodules = {};

  for (const name of submoduleNames) {
    const entry = gitmodules[name];
    if (entry) {
      sortedGitmodules[name] = entry;
    }
  }

  await fs.writeFile(
    path,
    gitSubmodules.serialize(sortedGitmodules).trimEnd() + "\n",
    "utf-8",
  );
}

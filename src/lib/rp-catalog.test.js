import { describe, expect, it } from "vitest";
import {
  sha256,
  validatePackageRecords,
  validateRegistryDelta,
} from "./rp-catalog.js";

const upstream = {
  rust: { submodule: "extensions/rust", version: "1.0.0" },
};
const addition = {
  pigments: {
    submodule: "extensions/pigments",
    path: "zed-pigments",
    version: "0.3.1",
    source_repository: "https://github.com/example/pigments.git",
    source_revision: "a".repeat(40),
    published_at: "2026-09-02T23:00:44Z",
  },
};
const sources = {
  "extensions/rust": {
    url: "https://github.com/example/rust.git",
    revision: "c".repeat(40),
  },
  "extensions/pigments": {
    url: "https://github.com/example/pigments.git",
    revision: "a".repeat(40),
  },
};

describe("validateRegistryDelta", () => {
  it("accepts an exact upstream mirror with a declared pinned addition", () => {
    expect(() =>
      validateRegistryDelta(
        {
          ...upstream,
          pigments: {
            submodule: "extensions/pigments",
            path: "zed-pigments",
            version: "0.3.1",
          },
        },
        upstream,
        addition,
        sources,
        { "extensions/rust": sources["extensions/rust"] },
      ),
    ).not.toThrow();
  });

  it("rejects removal or modification of an upstream entry", () => {
    expect(() =>
      validateRegistryDelta({}, upstream, addition, sources, {
        "extensions/rust": sources["extensions/rust"],
      }),
    ).toThrow('dropped upstream extension "rust"');

    expect(() =>
      validateRegistryDelta(
        {
          rust: { submodule: "extensions/rust", version: "2.0.0" },
          pigments: {
            submodule: "extensions/pigments",
            path: "zed-pigments",
            version: "0.3.1",
          },
        },
        upstream,
        addition,
        sources,
        { "extensions/rust": sources["extensions/rust"] },
      ),
    ).toThrow('modified upstream extension "rust"');
  });

  it("rejects a changed addition source revision", () => {
    expect(() =>
      validateRegistryDelta(
        {
          ...upstream,
          pigments: {
            submodule: "extensions/pigments",
            path: "zed-pigments",
            version: "0.3.1",
          },
        },
        upstream,
        addition,
        {
          "extensions/rust": sources["extensions/rust"],
          "extensions/pigments": {
            ...sources["extensions/pigments"],
            revision: "b".repeat(40),
          },
        },
        { "extensions/rust": sources["extensions/rust"] },
      ),
    ).toThrow("revision");
  });

  it("rejects a changed upstream source revision", () => {
    expect(() =>
      validateRegistryDelta(
        {
          ...upstream,
          pigments: {
            submodule: "extensions/pigments",
            path: "zed-pigments",
            version: "0.3.1",
          },
        },
        upstream,
        addition,
        {
          ...sources,
          "extensions/rust": {
            ...sources["extensions/rust"],
            revision: "d".repeat(40),
          },
        },
        { "extensions/rust": sources["extensions/rust"] },
      ),
    ).toThrow('modified upstream source for "rust"');
  });
});

describe("validatePackageRecords", () => {
  it("requires one valid immutable package per extension", () => {
    const record = {
      id: "rust",
      version: "1.0.0",
      schema_version: 1,
      wasm_api_version: null,
      source_repository: "https://github.com/example/rust.git",
      source_revision: "a".repeat(40),
      archive_url: "https://example.com/rust/1.0.0/archive.tar.gz",
      archive_size: 42,
      archive_sha256: "b".repeat(64),
    };

    expect(() => validatePackageRecords([record], ["rust"])).not.toThrow();
    expect(() => validatePackageRecords([], ["rust"])).toThrow(
      "Missing package records",
    );
  });
});

describe("sha256", () => {
  it("hashes catalog and archive bytes", () => {
    expect(sha256("rp")).toBe(
      "796e80c7e5bf8a48cb603f229eeec578ec72443dbfe37710cc80de67228c6713",
    );
  });
});

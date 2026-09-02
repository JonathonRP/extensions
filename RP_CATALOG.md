# RP Extensions catalog

`JonathonRP/extensions` is a history-preserving fork of
`zed-industries/extensions`. Its `main` branch is reserved for clean upstream
fast-forwards. The default, persistent `release/rp-stable` branch mirrors an
identified upstream revision and carries declared RP additions.

## Endpoint

- Catalog: <https://jonathonrp.github.io/extensions/rp-catalog/v1/catalog.json>
- Catalog SHA-256: <https://jonathonrp.github.io/extensions/rp-catalog/v1/catalog.json.sha256>
- JSON Schema: <https://jonathonrp.github.io/extensions/rp-catalog/v1/schema.json>
- Workflow: <https://github.com/JonathonRP/extensions/actions/workflows/rp-catalog.yml>

Schema version 1 contains the existing Zed `ExtensionMetadata` fields in
`data`, all known official version metadata in `versions`, and one integrity
record per current package in `packages`. Each package binds its ID, version,
schema/Wasm compatibility, immutable source repository and Git revision,
archive byte size, archive SHA-256, and HTTPS download URL.

Official entries use Zed's exact-version download route and permit only its API
and extension object-store hosts. RP additions are packaged with the same
pinned `zed-extension` CLI as upstream and are hosted under this Pages site.
RP clients must verify the catalog digest, allowlisted hosts, archive size and
SHA-256, then validate the packaged manifest before installation.

## Pigments

```toml
[pigments-lsp]
submodule = "extensions/pigments-lsp"
path = "zed-pigments"
version = "0.3.1"
```

The source is `https://github.com/JonathonRP/zed-pigments.git` pinned to
`545ee63ba654a57e322e109b09ff249c908c1ec6`.

## Publication and sync

The fork-only workflow is guarded to `JonathonRP/extensions`. It validates pull
requests targeting `release/rp-stable`, and publishes after pushes to that
branch, manual dispatches, and a daily 05:17 UTC refresh. Publication fails if
an upstream entry is removed or modified, an undeclared RP entry appears, the
Pigments pin changes, package metadata is malformed, or an archive cannot be
hashed.

To sync, fetch `zed-industries/extensions`, merge its `main` into
`release/rp-stable`, resolve only around declared RP files, and open a focused
fork PR. Never force-push the release branch or overwrite an existing
ID/version package. GitHub Pages and the official Zed archive service remain
availability dependencies; RP clients must fail closed rather than silently
fall back to a partial catalog.

# AGENTS.md

`@systemfsoftware/api-extractor`: versioned API model, diff and Effect-aware semver
verdict. Requirements and decisions: `docs/plans/2026-10-10-1146-feat-effect-api-extractor-plan.md`.

## Rules

- Read `docs/solutions/` before planning or changing code here.
- Every output goes through `canonicalJson` (`packages/api-extractor/src/canonical-json.schema.ts`).
  Order strings by UTF-16 code unit with effect's `Order.String`; never `localeCompare`,
  `toLocale*` or `Intl` in `src`.
- Code the verdict decision reaches lives in the workflow file or in `*.schema.ts` files
  beside the type it operates on (gate: `pnpm lint`, rule `dmmf-workflow(make-body-purity)`).
- A change to the model schema bumps `API_MODEL_SCHEMA_VERSION`.
- Bump semantics live in the rule corpus (`src/rules/corpus.v1.json`), not in code. A
  corpus change bumps its `corpusVersion`.
- A file derived from `microsoft/rushstack` or systemfsoftware PR #552 carries a header
  naming the repository, path and commit.
- Shared tooling (tsconfig bases, lint presets, release, mutation) comes from
  systemfsoftware family flakes and reusable workflows. Never copy it in.
- The family lint preset is never overridden locally: no rule set to `off`, ignore
  pattern or disable comment (gate: review of `oxlint.config.ts` and source diffs). A rule
  that forbids correct code is reported upstream as a preset defect.
- Mutation testing runs on `main` only.

## Commands

Run inside the dev shell (`nix develop --command …`), which copies `.sfs-deps/`:

```sh
pnpm run bootstrap   # sandboxed pnpm install --frozen-lockfile
pnpm test            # unit, property and the cross-locale e2e feature
pnpm lint
pnpm typecheck
```

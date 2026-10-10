# AGENTS.md

`@systemfsoftware/api-extractor`: versioned API model, diff and Effect-aware semver
verdict. Requirements and decisions: `docs/plans/2026-10-10-0517-feat-effect-api-extractor-plan.md`.

## Rules

- Every output goes through `canonicalJson` (`packages/api-extractor/src/canonical-json.ts`).
  Order strings with `compareCodeUnits`; never `localeCompare`, `toLocale*` or `Intl` in `src`.
- A change to the model schema bumps `API_MODEL_SCHEMA_VERSION`.
- Bump semantics live in the rule corpus (`src/rules/corpus.v1.json`), not in code. A
  corpus change bumps its `corpusVersion`.
- A file derived from `microsoft/rushstack` or systemfsoftware PR #552 carries a header
  naming the repository, path and commit.
- Shared tooling (tsconfig bases, lint presets, release, mutation) comes from
  systemfsoftware family flakes and reusable workflows. Never copy it in.
- Mutation testing runs on `main` only.

## Commands

```sh
pnpm install
pnpm test        # property tests, including the cross-locale process test
pnpm typecheck
```

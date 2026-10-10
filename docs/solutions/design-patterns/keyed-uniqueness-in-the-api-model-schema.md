---
title: Keyed uniqueness is a schema invariant only for identities; repeated export names are a diff pairing rule
date: 2026-10-10
category: design-patterns
module: api-extractor ApiModel schema and diff
problem_type: design_pattern
component: data_model
severity: medium
applies_when:
  - Adding a keyed collection (paths, member names, ids) to the ApiModel schema
  - A generated-model law such as diff(model, model) is none shrinks to a model with a repeated name
  - Choosing between a schema refinement and a pairing rule in the diff
symptoms:
  - Self-diff of a generated model reports export-kind-changed with bump major
root_cause: logic_error
tags: [effect-schema, arbitrary, uniqueby, property-laws, declaration-merging, schema-version]
---

# Keyed uniqueness is a schema invariant only for identities

## Problem and boundary

Two defects surfaced together. Code review found that `diffModels` reports a false major `export-kind-changed` when one scope exports a value and a type under the same name. A pilot of the law "a model diffed against itself has no changes", drawing from the production `ApiModel` schema, then shrank to a model with two entry points sharing the path `""`. Its self-diff also produced `enum-member-value-changed` from repeated enum member names. In both cases the schema accepted the models, so the generator was right to produce them. The defects appear only when a key repeats inside one scope. Hand-built fixtures use unique names, which is why the example tests never caught them.

## Mechanism

1. Pairing through a `Map` keyed by name keeps only the last after-item per name. Every before-item with that name is compared with the survivor, so `const X` is compared with `type X`, which emits `export-kind-changed`. Entry points keyed by path and enum members keyed by name collapse the same way.
2. Declaration merging makes `const X` beside `type X` legal TypeScript, so the repeated name is valid input, not noise.
3. The tempting fix is a uniqueness refinement on item names. It makes the law pass because the generator can no longer draw the counterexample. That masks defect 1 for every consumer package that exports a value and a type under one name.
4. Grouping by kind is not enough. Pairing the same-kind items under one name by stored position makes the diff read the producer's order, and the canonical bytes hide that order. Two byte-identical models holding two same-name `function` items in opposite orders were judged as changed.

## Architectural invariants

**Identity vs label.** Each keyed array in the model is classified before its schema is written:

| Key | Class | Where it is enforced |
|---|---|---|
| item name within an entry point or namespace | label (may repeat) | diff pairing: `compareItems` groups by name; `compareNamed` pairs equal items first, then the rest of each kind in canonical-key order, then only the leftovers across kinds |
| entry-point path | identity | schema refinement `uniqueBy` on `ApiModel.entryPoints` |
| enum member name | identity | schema refinement `uniqueBy` on the enum item's `members` |

**Keyed uniqueness carries its generation hint.** Effect 4's `Schema.isUnique` compares whole elements by Effect equality and takes no key. Keyed uniqueness is a `Schema.makeFilter` whose annotations set `arbitraryConstraint.uniqueBy`, a field of `Annotations.GenerationConstraint`. `Arbitrary.schema(ApiModel)` then builds arrays that already satisfy the key:

```ts
const uniqueBy = <A>(what: string, key: (value: A) => string) =>
  Schema.makeFilter((values: ReadonlyArray<A>) => new Set(values.map(key)).size === values.length, {
    expected: `${what} unique by key`,
    arbitraryConstraint: { uniqueBy: key },
  })
```

According to the `architect-property-tests` skill's schema-arbitrary reference, a custom filter without a generation hint falls back to generate-then-discard. Rejection rates were not measured for this schema.

**A refinement is a wire change.** Narrowing what decodes bumps `API_MODEL_SCHEMA_VERSION`. Adding `uniqueBy` moved it from 1 to 2, per the root `AGENTS.md` rule.

**Code smells to grep for:**

- `new Map(items.map((item) => [item.name, item]))` in diff code: name-keyed pairing that drops merged declarations.
- `Schema.makeFilter(...)` over an array with no `arbitraryConstraint`: a uniqueness filter the generator can only satisfy by rejection.
- A uniqueness `.check(...)` added in the same change that makes a failing generated law pass: confirm that the key is an identity before accepting it.
- Index pairing over items that share a key the schema allows to repeat: positional pairing that depends on storage order.

## Verification

- The property "has no changes against itself, whatever order the two items come in", under "verdict on a value and a type sharing a name", failed before PR #1's pairing fix and passed after it. It now runs through `it.prop` with the constant-impostor gate on.
- With `uniqueBy` added, the pilot's 200-model fixed-seed sample from the production schema produced no self-diff changes. PR #1 (systemfsoftware/api-extractor-effect) CI is green.
- The property "has no changes between two models storing them in either order", under "verdict on exports sharing a name and a kind", failed on its first run against position pairing and passes with canonical-order pairing.

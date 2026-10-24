---
"@systemfsoftware/api-extractor": minor
---

The API model is now schema version 3, a breaking change for stored models: a
model written under version 2 is refused. Every item carries its source anchor
(repository-relative file and 1-based line, or `null`), its release tag
(`public`, `beta`, `alpha`, `internal` or `untagged`) and its `@stability`
value; the model carries the package's `exports` and `imports` maps, the
analysis messages with their anchors, the anchor base and the coverage.

`readPackage` now resolves each export through the requested condition, then
`types`, `import`, `default` and the first remaining key; a bare-string
`exports` names `.`; a target that is not TypeScript source refuses with the
key and target named; and an `imports` map is recorded as internal surface, so
a package with an imports map and no `exports` analyses to zero entry points.
`FrontEnd.analyse` returns `{ route, model }`, with the messages and coverage
in the model. A source index gives both emitter routes the same anchors
without declaration maps, and type parameters keep their `in`, `out` and
`const` modifiers.

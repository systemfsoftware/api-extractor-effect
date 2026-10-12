---
"@systemfsoftware/api-extractor": minor
---

Add the `FrontEnd` namespace. It reads a package and emits its declarations two ways behind one emitter port: on the isolated-declarations fast path (oxc-transform), or through the TypeScript 7 compiler when a package's exports are not annotated. One syntactic builder turns those declarations into the versioned API model, and a syntactic resolver reports five api-extractor analysis messages. Both routes produce the same model.

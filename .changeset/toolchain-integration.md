---
"@systemfsoftware/api-extractor": none
---

The public surface changes in three ways. `Verdict.CompareSurfaces` takes a required `engine` string. `ApiModel.decode` accepts a JSON value (`Schema.Json`) instead of `unknown`. The package root export now resolves to the built JavaScript and declarations, and the TypeScript source sits behind the `@systemfsoftware/source` export condition. `Verdict` also exports the `ChannelType` schema. Version 0.0.0 was never released, so no published version breaks. To upgrade, pass `engine` when you construct `CompareSurfaces`, and pass `ApiModel.decode` a parsed JSON value.

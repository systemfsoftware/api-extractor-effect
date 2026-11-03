export { type Analysis, analyse } from './front-end/analyse.ts'
export { AnalysisMessage } from './model/message.schema.ts'
export { buildModel } from './front-end/build-model.ts'
export {
  CompilerEmitter,
  type CompilerEmitterId,
  type DeclarationEmitter,
  IsolatedEmitter,
  type IsolatedEmitterId,
} from './front-end/declaration-emitter.service.ts'
export { type DeclarationFile, Declarations, Diagnostic, Note, type PackageSource, Reported, type SourceEntryPoint } from './front-end/declarations.schema.ts'
export { CompilerRejected, ManifestRejected, NoSourceEntry, NotIsolated, UnsupportedDeclaration } from './front-end/front-end-error.schema.ts'
export { layer as isolatedEmitterLayer, OXC_TRANSFORM_PRODUCER } from './front-end/oxc-isolated-emitter.ts'
export { FAMILY_SOURCE_CONDITION, readPackage, type ReadPackageRequest } from './front-end/read-package.ts'
export { resolveMessages } from './front-end/resolve-messages.ts'
export { Fallback, FastPath, Route } from './front-end/route.schema.ts'
export {
  compilerEmitPolicy,
  type CompilerEmitPolicy,
  type CompilerEmitPolicyRequest,
  writeDerivedTsconfig,
  type DerivedTsconfigRequest,
  layer as compilerEmitterLayer,
  TYPESCRIPT_PRODUCER,
} from './front-end/typescript-7-compiler.ts'

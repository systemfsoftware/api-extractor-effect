import { canonicalJson } from '../canonical-json.schema.ts'
import { type ApiModel, encodeApiModel, sortModel } from './api-model.schema.ts'

/** The model as canonical JSON bytes: equal surfaces give equal bytes in any environment. */
export const serialiseApiModel = (model: ApiModel): string => canonicalJson(encodeApiModel(sortModel(model)))

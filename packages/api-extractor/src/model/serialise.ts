import { canonicalJson } from '../canonical-json.ts'
import { type ApiModel, encodeApiModel } from './api-model.ts'
import { sortModel } from './normalise.ts'

/** The model as canonical JSON bytes: equal surfaces give equal bytes in any environment. */
export const serialiseApiModel = (model: ApiModel): string => canonicalJson(encodeApiModel(sortModel(model)))

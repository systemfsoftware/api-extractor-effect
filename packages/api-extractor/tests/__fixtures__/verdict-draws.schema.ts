import { Schema } from 'effect'

export const tags = [Schema.String, Schema.Array(Schema.String)] as const

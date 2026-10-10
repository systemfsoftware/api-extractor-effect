import { ApiModel } from '@systemfsoftware/api-extractor'
import { text } from 'node:stream/consumers'
import { outputsOf } from './outputs.ts'

const models = (JSON.parse(await text(process.stdin)) as ReadonlyArray<unknown>).map(ApiModel.decode)
const options = new Intl.DateTimeFormat().resolvedOptions()
process.stdout.write(JSON.stringify({ locale: options.locale, timeZone: options.timeZone, cwd: process.cwd(), outputs: outputsOf(models) }))

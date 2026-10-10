/**
 * Runs in a child process under a given locale, time zone and working directory.
 * Reads a JSON array of models on stdin and prints, as JSON, the locale the
 * process actually resolved and the bytes of every model and of the verdict
 * between each consecutive pair.
 */
import { text } from 'node:stream/consumers'
import { canonicalJson } from '../../src/canonical-json.ts'
import { decodeApiModel, encodeApiModel } from '../../src/model/api-model.ts'
import { sortModel } from '../../src/model/normalise.ts'
import { serialiseVerdict, verdict } from '../../src/verdict.ts'

const models = (JSON.parse(await text(process.stdin)) as ReadonlyArray<unknown>).map(decodeApiModel)
const options = new Intl.DateTimeFormat().resolvedOptions()
const outputs = [
  ...models.map((model) => canonicalJson(encodeApiModel(sortModel(model)))),
  ...models.slice(1).map((after, index) => serialiseVerdict(verdict(models[index]!, after))),
]
process.stdout.write(JSON.stringify({ locale: options.locale, timeZone: options.timeZone, cwd: process.cwd(), outputs }))

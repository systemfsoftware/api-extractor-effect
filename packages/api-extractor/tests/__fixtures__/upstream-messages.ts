import { Extractor, ExtractorConfig, type ExtractorMessage } from '@microsoft/api-extractor'
import { type FrontEnd } from '@systemfsoftware/api-extractor'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

const FIVE_IDS: ReadonlyArray<string> = [
  'ae-forgotten-export',
  'ae-incompatible-release-tags',
  'ae-internal-missing-underscore',
  'ae-internal-mixed-release-tag',
  'ae-missing-release-tag',
]

const TSCONFIG = {
  compilerOptions: {
    target: 'esnext',
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    noEmit: true,
  },
}

const firstQuoted = (text: string): string => {
  const match = /"([^"]*)"/.exec(text)
  return match === null ? '' : match[1] ?? ''
}

const subjectOf = (message: ExtractorMessage): ReadonlyArray<ReadonlyArray<string>> =>
  FIVE_IDS.includes(message.messageId) ? [[message.messageId, firstQuoted(message.text)]] : []

const sortedPairs = (pairs: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<readonly [string, string]> =>
  pairs
    .map(([messageId, symbol]) => [messageId ?? '', symbol ?? ''] as const)
    .sort((left, right) => (left.join('\u0000') < right.join('\u0000') ? -1 : 1))

const writtenFiles = (root: string, declarations: FrontEnd.Declarations): void => {
  for (const file of declarations.files) {
    const target = join(root, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.text)
  }
}

const runExtractor = (root: string, entry: string): ReadonlyArray<ReadonlyArray<string>> => {
  const messages: Array<ExtractorMessage> = []
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: root,
      mainEntryPointFilePath: join(root, entry),
      compiler: { tsconfigFilePath: join(root, 'tsconfig.json') },
      apiReport: { enabled: false },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
    },
    configObjectFullPath: join(root, 'api-extractor.json'),
    packageJsonFullPath: join(root, 'package.json'),
  })
  Extractor.invoke(config, {
    messageCallback: (message: ExtractorMessage) => void messages.push(message),
    localBuild: true,
    showVerboseMessages: false,
    showDiagnostics: false,
  })
  return messages.flatMap(subjectOf)
}

export const upstreamPairs = (declarations: FrontEnd.Declarations): ReadonlyArray<readonly [string, string]> => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-messages-'))
  try {
    symlinkSync(join(packageRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: declarations.package.name, version: declarations.package.version }))
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG))
    writtenFiles(root, declarations)
    return sortedPairs(runExtractor(root, declarations.entryPoints[0]?.declarationFile ?? 'index.d.ts'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export type DeclarationRequest = {
  readonly entry: string
  readonly files: ReadonlyArray<ReadonlyArray<string>>
}

export const declarationsOf = (request: DeclarationRequest): FrontEnd.Declarations => ({
  producer: 'fixture',
  package: { name: 'fixture', version: '1.0.0' },
  entryPoints: [{ exportPath: '.', declarationFile: request.entry }],
  files: request.files.map(([path, text]) => ({ path: path ?? '', text: text ?? '' })),
})

import manifest from '../package.json' with { type: 'json' }

/** `<package>@<version>` of this engine, stamped into every output. */
export const ENGINE: string = `${manifest.name}@${manifest.version}`

import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

export const USER_AGENT = `uvd/${VERSION} (+https://github.com/UltravioletaDAO/uvd)`;

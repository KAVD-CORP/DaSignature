/** Product name. One word, capital D and S (SPEC Sec 11). */
export const APP_NAME = 'DaSignature';

/** App version, kept in sync with the root package.json. */
export const APP_VERSION = '0.1.0';

/** Platforms DaSignature targets from one codebase (SPEC Sec 1). */
export const PLATFORMS = ['web', 'ios', 'android', 'windows', 'macos', 'linux'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Producer string written into exported PDFs (SPEC Sec 7.5 step 6). */
export function producerString(version: string = APP_VERSION): string {
  return `${APP_NAME} ${version}`;
}

export * from './pen.ts';
export * from './image.ts';

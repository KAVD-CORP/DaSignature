/**
 * English message catalog (source locale). Keys are namespaced `<screen>.<feature>.<message>`;
 * other locales provide the same shape (`Messages`). Full catalogs land with M7 (Sec 10).
 * Copy: design/screens/copy/clear-data-confirm.md (D9, PM #44).
 */
export const en = {
  settings: {
    clearData: {
      row: 'Clear all data',
      rowHelp: 'Deletes all documents, signatures and settings from this device.',
      title: 'Clear all data?',
      body: "All documents, signed copies, signatures and settings are permanently deleted from this device. This can't be undone. Backups you saved elsewhere are not affected.",
      /** Translators: one short, common word meaning "delete", typeable on the locale's default keyboard, no spaces or punctuation; uppercase where the script has case. */
      confirmWord: 'DELETE',
      confirmLabel: 'Type {confirmWord} to confirm',
      confirmHelp: "This makes sure you don't clear your data by accident.",
      mismatch: 'Type {confirmWord} exactly as shown.',
      confirmButton: 'Clear all data',
      cancel: 'Cancel',
      progress: 'Clearing data…',
      done: 'All data cleared',
    },
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
/** Shape every locale's catalog must have. */
export type Messages = Widen<typeof en>;

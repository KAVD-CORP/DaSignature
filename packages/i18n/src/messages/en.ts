/**
 * English message catalog (source locale). Keys are namespaced `<screen>.<feature>.<message>`;
 * other locales provide the same shape (`Messages`). Full catalogs land with M7 (Sec 10).
 * Copy: design/screens/copy/clear-data-confirm.md (D9, PM #44).
 */
export const en = {
  app: {
    storedLocally: 'Stored on this device only',
    loading: 'Opening DaSignature…',
    bootError: "DaSignature couldn't open its storage on this device.",
    retry: 'Try again',
    close: 'Close',
    cancel: 'Cancel',
    undo: 'Undo',
    dismiss: 'Dismiss',
    ok: 'OK',
  },
  nav: {
    label: 'Main',
    library: 'Library',
    signatures: 'Signatures',
    settings: 'Settings',
  },
  library: {
    title: 'Library',
    openPdf: 'Open PDF',
    search: 'Search documents',
    emptyTitle: 'No documents yet',
    emptyBody: 'Open a PDF to sign it. It stays on this device and is never uploaded.',
    emptyDrop: 'or drop a PDF anywhere in this window',
    noResults: 'No documents match “{query}”.',
    dropToOpen: 'Drop to open',
    draft: 'Draft',
    signed: 'Signed',
    pages: '{count} pages',
    onePage: '1 page',
    edited: 'Edited {date}',
    moreFor: 'More actions for {title}',
    delete: 'Delete',
    deleteTitle: 'Delete “{title}”?',
    deleteBody:
      'The original PDF, drafts and signed copies stored in DaSignature are removed from this device. Files you saved elsewhere are not affected.',
    deleted: 'Document deleted',
    multiDrop: 'Opened 1 of {count}. DaSignature opens one PDF at a time.',
    opening: 'Opening “{name}”…',
    large: 'Large file, this may take a moment',
    storageFull: 'Not enough storage on this device. Delete documents or free up space.',
    persistNote:
      'Your browser can clear site data. Make a backup in Settings to keep your signatures safe.',
    backupNow: 'Back up now',
  },
  password: {
    title: 'This PDF is protected',
    body: "Enter the password to open it. DaSignature won't store the password.",
    label: 'Password',
    show: 'Show password',
    hide: 'Hide password',
    open: 'Open',
    wrong: "That password didn't work. Try again.",
  },
  viewer: {
    back: 'Back to Library',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    zoomLevel: 'Zoom level {percent}%',
    fitWidth: 'Fit width',
    pages: 'Pages',
    collapsePages: 'Collapse pages',
    expandPages: 'Show pages',
    pageOf: 'Page {page} of {count}',
    pageShort: 'Page {page} / {count}',
    goToPage: 'Go to page',
    pageError: "Page {page} couldn't be displayed",
    loadError: "This PDF couldn't be read. It may be damaged.",
  },
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
  storage: {
    /** PM #69: data or a backup from a newer app version is refused, untouched. */
    updateRequired: {
      title: 'Update DaSignature',
      database:
        'Your data was saved by a newer version of DaSignature. Update DaSignature to open it. Nothing was changed.',
      backup:
        'This backup was made by a newer version of DaSignature. Update DaSignature to open it. Nothing was changed.',
    },
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
/** Shape every locale's catalog must have. */
export type Messages = Widen<typeof en>;

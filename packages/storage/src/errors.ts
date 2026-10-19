/** Typed errors so callers (and the backup restore) can tell failure modes apart. */
export class StorageError extends Error {
  override name = 'StorageError';
}
export class StorageBusyError extends StorageError {
  override name = 'StorageBusyError';
}
export class StorageClosedError extends StorageError {
  override name = 'StorageClosedError';
}
export class FileNotFoundError extends StorageError {
  override name = 'FileNotFoundError';
}
export class DecryptionError extends StorageError {
  override name = 'DecryptionError';
}
export class WrongPasswordError extends StorageError {
  override name = 'WrongPasswordError';
}
export class BackupFormatError extends StorageError {
  override name = 'BackupFormatError';
}
export class BackupCorruptError extends StorageError {
  override name = 'BackupCorruptError';
}
/** The backup password is wrong (the manifest's key check failed). Nothing was restored. */
export class BackupPasswordError extends WrongPasswordError {
  override name = 'BackupPasswordError';
}
/**
 * PM #69: the data needs a newer app. `messageKey` is the i18n key the UI shows
 * (packages/i18n: storage.updateRequired.*). Nothing was changed when this is thrown.
 */
export interface UpdateRequired {
  readonly updateRequired: true;
  readonly messageKey: 'storage.updateRequired.database' | 'storage.updateRequired.backup';
}
export function isUpdateRequired(err: unknown): err is Error & UpdateRequired {
  return err instanceof Error && (err as Partial<UpdateRequired>).updateRequired === true;
}

/** The database schema is newer than this app knows (downgrade refused, data untouched). */
export class SchemaTooNewError extends StorageError implements UpdateRequired {
  override name = 'SchemaTooNewError';
  readonly updateRequired = true as const;
  readonly messageKey = 'storage.updateRequired.database' as const;
}

/** The backup comes from a newer app (format or schema version this build cannot read). */
export class BackupVersionError extends BackupFormatError implements UpdateRequired {
  override name = 'BackupVersionError';
  readonly updateRequired = true as const;
  readonly messageKey = 'storage.updateRequired.backup' as const;
}

/** PM #68: restore replaces all data, so the caller must pass the explicit confirmation. */
export class RestoreNotConfirmedError extends StorageError {
  override name = 'RestoreNotConfirmedError';
}
/** The app is locked with a passcode; unlock it before opening the data. */
export class LockedError extends StorageError {
  override name = 'LockedError';
}

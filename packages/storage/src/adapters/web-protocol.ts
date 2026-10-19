/** Messages between WebStorageAdapter (main thread) and web-worker.ts. */
export interface WorkerConfig {
  /** OPFS directory for the SQLite sahpool VFS. */
  vfsDir: string;
  /** OPFS directory for file blobs. */
  filesDir: string;
  dbName: string;
}
export type WorkerOp =
  'open' | 'exec' | 'query' | 'writeFile' | 'readFile' | 'removeFile' | 'usage' | 'close';
export interface WorkerRequest {
  id: number;
  op: WorkerOp;
  args: unknown[];
}
export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string } };

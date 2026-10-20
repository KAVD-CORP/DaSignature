/// <reference lib="webworker" />
/** Runs the pdf-lib export off the main thread (design 06: the UI never freezes). */
import { ExportError, exportSigned, type ExportInput } from '@dasignature/pdf/export';

export type WorkerRequest = Omit<ExportInput, 'onProgress'>;
export type WorkerMessage =
  | { type: 'progress'; stage: 'signatures' | 'flatten' | 'write' }
  | { type: 'done'; bytes: Uint8Array; sha256: string }
  | { type: 'error'; code: string; message: string };

const post = (m: WorkerMessage, transfer: Transferable[] = []) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);
};

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  void exportSigned({
    ...e.data,
    now: e.data.now ? new Date(e.data.now) : new Date(),
    onProgress: (stage) => {
      post({ type: 'progress', stage });
    },
  })
    .then(({ bytes, sha256 }) => {
      post({ type: 'done', bytes, sha256 }, [bytes.buffer]);
    })
    .catch((err: unknown) => {
      post({
        type: 'error',
        code: err instanceof ExportError ? err.code : 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });
    });
};

/**
 * Files handed to the app from outside (M8): PWA file_handlers (launchQueue) and share_target
 * (stashed by the service worker), Tauri "Open with" / file association, and Android VIEW / SEND
 * intents. Each source delivers File objects to one callback; the shell menu is wired here too.
 */
import { fromBase64 } from '@dasignature/storage';
import { navigate } from '../state/route.ts';
import { mobileNative, tauriInvoke, type NativeFile } from './native.ts';

type Deliver = (files: File[]) => void;

const toFile = (f: NativeFile) =>
  new File([fromBase64(f.data).slice().buffer], f.name, { type: 'application/pdf' });

interface LaunchParams {
  files: readonly { getFile(): Promise<File> }[];
}
interface LaunchWindow {
  launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void };
}

export const SHARE_CACHE = 'dasig-share';

/** Reads and clears the files the service worker stashed for /?shared=1. */
export async function takeSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (!res) continue;
    const name = decodeURIComponent(res.headers.get('x-name') ?? 'shared.pdf');
    files.push(new File([await res.arrayBuffer()], name, { type: 'application/pdf' }));
  }
  await caches.delete(SHARE_CACHE);
  return files;
}

async function desktopTake(deliver: Deliver): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  const paths = (await invoke('opened_files_take')) as string[];
  const files: File[] = [];
  for (const path of paths) {
    const data = (await invoke('opened_file_read', { path })) as string;
    files.push(toFile({ name: path.split(/[\\/]/).pop() ?? 'document.pdf', data }));
  }
  if (files.length) deliver(files);
}

async function mobileTake(deliver: Deliver): Promise<void> {
  const native = mobileNative();
  if (!native) return;
  const { files } = await native.takeOpenedFiles();
  if (files.length) deliver(files.map(toFile));
}

/** Shell menu items (Tauri native menu) other than those a screen handles itself (export). */
function onMenu(e: Event, openPicker: () => void): void {
  const id = (e as CustomEvent<string>).detail;
  if (id === 'open') openPicker();
  else if (id === 'library') navigate({ name: 'library' });
  else if (id === 'signatures') navigate({ name: 'signatures' });
  else if (id === 'settings' || id === 'about') navigate({ name: 'settings' });
}

export function installInbound(deliver: Deliver, openPicker: () => void): () => void {
  const ignore = (err: unknown) => {
    console.warn('inbound files', err);
  };
  const lq = (globalThis as LaunchWindow).launchQueue;
  lq?.setConsumer((p) => {
    void Promise.all(p.files.map((h) => h.getFile()))
      .then((files) => {
        if (files.length) deliver(files);
      })
      .catch(ignore);
  });
  if (new URLSearchParams(location.search).has('shared')) {
    history.replaceState(null, '', location.pathname + location.hash);
    void takeSharedFiles()
      .then((files) => {
        if (files.length) deliver(files);
      })
      .catch(ignore);
  }
  const take = () => {
    void desktopTake(deliver).catch(ignore);
    void mobileTake(deliver).catch(ignore);
  };
  take();
  const menu = (e: Event) => {
    onMenu(e, openPicker);
  };
  addEventListener('dasig-open', take);
  addEventListener('dasig-menu', menu);
  const native = mobileNative();
  const sub = native?.addListener('opened', take);
  return () => {
    removeEventListener('dasig-open', take);
    removeEventListener('dasig-menu', menu);
    void sub?.then((s) => s.remove());
  };
}

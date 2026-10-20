/**
 * FileAdapter for browsers and webviews (web, Tauri, Capacitor webview): a hidden <input type=file>
 * for picking, and an <a download> for saving. Shells may replace saveFile with native dialogs.
 */
import type { FileAdapter } from '@dasignature/storage';

export function pickFiles(accept = 'application/pdf,.pdf'): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}

export function webFiles(): FileAdapter {
  return {
    async pickPdf() {
      const [file] = await pickFiles();
      if (!file) return null;
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },
    saveFile(name, bytes, mime) {
      downloadBytes(name, bytes, mime);
      return Promise.resolve({ savedAs: name });
    },
  };
}

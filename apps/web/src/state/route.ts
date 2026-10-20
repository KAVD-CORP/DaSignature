import { useSyncExternalStore } from 'react';

export type Route =
  { name: 'library' } | { name: 'doc'; id: string } | { name: 'signatures' } | { name: 'settings' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const doc = /^\/doc\/([0-9a-f-]{36})$/.exec(path);
  if (doc?.[1]) return { name: 'doc', id: doc[1] };
  if (path === '/signatures') return { name: 'signatures' };
  if (path === '/settings') return { name: 'settings' };
  return { name: 'library' };
}

export function hrefFor(r: Route): string {
  switch (r.name) {
    case 'doc':
      return `#/doc/${r.id}`;
    case 'library':
      return '#/';
    default:
      return `#/${r.name}`;
  }
}

export function navigate(r: Route): void {
  location.hash = hrefFor(r);
}

const subscribe = (cb: () => void) => {
  addEventListener('hashchange', cb);
  return () => {
    removeEventListener('hashchange', cb);
  };
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseHash(hash);
}

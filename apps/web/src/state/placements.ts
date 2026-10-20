/**
 * Editor placement state (SPEC Sec 7.4, design 03): items, selection, tool, undo/redo and the
 * 500 ms debounced autosave to the encrypted placements table.
 */
import { create } from 'zustand';
import { History, type Box, type FieldData, type FieldType } from '@dasignature/core';
import { uuidv7, type DataStore, type PlacementRecord } from '@dasignature/storage';

export interface Placed extends Box {
  id: string;
  page: number;
  type: FieldType;
  signatureId: string | null;
  rotation: number;
  opacity: number;
  data: FieldData & {
    /** Vector signatures are snapshotted so editing/deleting the saved one never changes a placed one. */
    svg?: string;
    color?: string;
    sigOpacity?: number;
  };
  z: number;
}

export function fromRecord(r: PlacementRecord): Placed {
  let data: Placed['data'] = {};
  try {
    data = r.data_json ? (JSON.parse(r.data_json) as Placed['data']) : {};
  } catch {
    /* keep empty */
  }
  const type: FieldType =
    r.type === 'text' && data.field === 'name' ? 'name' : r.type === 'annotation' ? 'text' : r.type;
  return {
    id: r.id,
    page: r.page_index,
    type,
    signatureId: r.signature_id,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    rotation: r.rotation,
    opacity: r.opacity,
    data,
    z: r.z_index,
  };
}

export function toRecord(p: Placed, documentId: string): PlacementRecord {
  const data = p.type === 'name' ? { ...p.data, field: 'name' as const } : p.data;
  return {
    id: p.id,
    document_id: documentId,
    page_index: p.page,
    type: p.type === 'name' ? 'text' : p.type,
    signature_id: p.signatureId,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    rotation: p.rotation,
    opacity: p.opacity,
    data_json: JSON.stringify(data),
    z_index: p.z,
  };
}

interface PlacementState {
  docId: string | undefined;
  items: Placed[];
  selected: string | undefined;
  tool: FieldType | undefined;
  /** Signature id chosen for the signature/initials tool (else the default of that kind). */
  toolSignature: string | undefined;
  savedAt: number;
  canUndo: boolean;
  canRedo: boolean;
  live: string;
  lockAspect: boolean;
}

const AUTOSAVE_MS = 500;
let history = new History<Placed[]>();
let store: DataStore | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let dragStart: Placed[] | undefined;
let lastKey: string | undefined;
let lastAt = 0;

export const usePlacements = create<PlacementState>()(() => ({
  docId: undefined,
  items: [],
  selected: undefined,
  tool: undefined,
  toolSignature: undefined,
  savedAt: 0,
  canUndo: false,
  canRedo: false,
  live: '',
  lockAspect: true,
}));

const set = usePlacements.setState;
const get = usePlacements.getState;

function flags() {
  return { canUndo: history.canUndo, canRedo: history.canRedo };
}

async function saveNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const { docId, items } = get();
  if (!store || !docId) return;
  await store.savePlacements(
    docId,
    items.map((p) => toRecord(p, docId)),
  );
  set({ savedAt: Date.now() });
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void saveNow().catch(() => undefined);
  }, AUTOSAVE_MS);
}

export const placements = {
  async load(docId: string, ds: DataStore): Promise<void> {
    await placements.flush();
    store = ds;
    history = new History();
    const items = (await ds.listPlacements(docId)).map(fromRecord);
    set({
      docId,
      items,
      selected: undefined,
      tool: undefined,
      savedAt: 0,
      ...flags(),
    });
  },
  async flush(): Promise<void> {
    if (timer) await saveNow().catch(() => undefined);
  },
  reset(): void {
    void placements.flush();
    set({ docId: undefined, items: [], selected: undefined, tool: undefined });
  },
  /** Commits a new item list as one undo step and autosaves. */
  commit(next: Placed[], extra: Partial<PlacementState> = {}): void {
    history.push(get().items);
    set({ items: next, ...extra, ...flags() });
    schedule();
  },
  add(p: Omit<Placed, 'id' | 'z'>): Placed {
    const items = get().items;
    const z = items.reduce((m, i) => Math.max(m, i.z + 1), 0);
    const item: Placed = { ...p, id: uuidv7(), z };
    placements.commit([...items, item], { selected: item.id, tool: undefined });
    return item;
  },
  /** Updates one item. Calls with the same `coalesce` key within 800 ms share one undo step
   * (slider drags, typing). */
  update(id: string, patch: Partial<Placed>, coalesce?: string): void {
    const next = get().items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    const key = coalesce ? `${id}:${coalesce}` : undefined;
    const now = Date.now();
    if (key && key === lastKey && now - lastAt < 800) {
      set({ items: next });
      schedule();
    } else placements.commit(next);
    lastKey = key;
    lastAt = now;
  },
  /** Live update during a gesture: one undo step for the whole drag (beginGesture/endGesture). */
  beginGesture(): void {
    dragStart = get().items;
  },
  live(id: string, patch: Partial<Placed>): void {
    set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  },
  inGesture(): boolean {
    return dragStart !== undefined;
  },
  endGesture(): boolean {
    const start = dragStart;
    dragStart = undefined;
    if (!start || start === get().items) return false;
    history.push(start);
    set(flags());
    schedule();
    return true;
  },
  remove(id: string): void {
    placements.commit(
      get().items.filter((i) => i.id !== id),
      { selected: undefined },
    );
  },
  duplicate(id: string): Placed | undefined {
    const src = get().items.find((i) => i.id === id);
    if (!src) return undefined;
    const { id: _id, z: _z, ...rest } = src;
    return placements.add({ ...rest, x: src.x + 0.02, y: src.y + 0.02 });
  },
  undo(): void {
    const prev = history.undo(get().items);
    if (!prev) return;
    const sel = get().selected;
    set({ items: prev, selected: prev.some((i) => i.id === sel) ? sel : undefined, ...flags() });
    schedule();
  },
  redo(): void {
    const next = history.redo(get().items);
    if (!next) return;
    const sel = get().selected;
    set({ items: next, selected: next.some((i) => i.id === sel) ? sel : undefined, ...flags() });
    schedule();
  },
  select(id: string | undefined): void {
    set({ selected: id });
  },
  setTool(tool: FieldType | undefined, signatureId?: string): void {
    set({ tool, toolSignature: signatureId, selected: undefined });
  },
  setLockAspect(lockAspect: boolean): void {
    set({ lockAspect });
  },
  announce(text: string): void {
    // Toggle a zero-width char so repeated messages are re-announced.
    set({ live: get().live.endsWith('\u200b') ? text : `${text}\u200b` });
  },
};

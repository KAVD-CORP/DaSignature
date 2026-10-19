import { MemoryBackend, MemoryStorageAdapter } from '../src/adapters/memory.ts';
import { runStorageContract } from './contract.ts';

runStorageContract('MemoryStorageAdapter', () => {
  const backend = new MemoryBackend();
  return { create: (o) => new MemoryStorageAdapter(backend, o) };
});

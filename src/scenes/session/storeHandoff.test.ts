import { describe, expect, it } from 'vitest';
import { claimStore, STORE_RELEASE_KEY, type RegistryLike } from './storeHandoff';

function registry(): RegistryLike & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return { map, get: (k) => map.get(k), set: (k, v) => map.set(k, v) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('claimStore', () => {
  it('first claim is ready at once', async () => {
    const reg = registry();
    let ready = false;
    void claimStore(reg).ready.then(() => { ready = true; });
    await tick();
    expect(ready).toBe(true);
  });

  it('the next claim waits for the previous release and its close', async () => {
    const reg = registry();
    const a = claimStore(reg);
    const b = claimStore(reg);
    let bReady = false;
    void b.ready.then(() => { bReady = true; });
    await tick();
    expect(bReady).toBe(false);
    let closeDone!: () => void;
    a.release(new Promise<void>((r) => { closeDone = r; }));
    await tick();
    expect(bReady).toBe(false);
    closeDone();
    await tick();
    expect(bReady).toBe(true);
  });

  it('a rejected close still releases', async () => {
    const reg = registry();
    const a = claimStore(reg);
    const b = claimStore(reg);
    a.release(Promise.reject(new Error('close failed')));
    await expect(b.ready).resolves.toBeUndefined();
  });

  it('chains: a third claim waits for the first even if the second released early', async () => {
    const reg = registry();
    const a = claimStore(reg);
    const b = claimStore(reg);
    b.release(); // gave up before ever opening the store
    const c = claimStore(reg);
    let cReady = false;
    void c.ready.then(() => { cReady = true; });
    await tick();
    expect(cReady).toBe(false);
    a.release();
    await tick();
    expect(cReady).toBe(true);
  });

  it('ignores a non-promise registry value and repeated releases', async () => {
    const reg = registry();
    reg.set(STORE_RELEASE_KEY, 'garbage');
    const a = claimStore(reg);
    await expect(a.ready).resolves.toBeUndefined();
    a.release();
    a.release(new Promise(() => {}));
    await expect(claimStore(reg).ready).resolves.toBeUndefined();
  });
});

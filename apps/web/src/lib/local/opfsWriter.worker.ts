import '../zodSetup';
import { z } from 'zod';

// Writes a clip copy into the Origin Private File System with a synchronous access handle, for
// browsers that have OPFS but not `createWritable` on the main thread (older Safari). One
// message in, one message out.

const requestSchema = z.object({
  directory: z.string().min(1),
  name: z.string().min(1),
  file: z.instanceof(Blob),
});

interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}
interface SyncFileHandle {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
}

interface WriterScope {
  postMessage(message: { ok: boolean; error?: string }): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}
const scope = self as unknown as WriterScope;

async function write(directory: string, name: string, file: Blob): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(directory, { create: true });
  const handle = (await dir.getFileHandle(name, { create: true })) as unknown as SyncFileHandle;
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    const reader = file.stream().getReader();
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      at += access.write(value, { at });
    }
    access.flush();
  } finally {
    access.close();
  }
}

scope.addEventListener('message', (event) => {
  const parsed = requestSchema.safeParse(event.data);
  if (!parsed.success) {
    scope.postMessage({ ok: false, error: 'bad request' });
    return;
  }
  const { directory, name, file } = parsed.data;
  write(directory, name, file).then(
    () => scope.postMessage({ ok: true }),
    (error: unknown) =>
      scope.postMessage({ ok: false, error: error instanceof Error ? error.name : 'failed' }),
  );
});

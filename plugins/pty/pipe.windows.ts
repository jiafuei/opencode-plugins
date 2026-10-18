import { dlopen } from "bun:ffi";

const kernel = dlopen("kernel32.dll", {
  CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "i64"], returns: "i64" },
  GetNamedPipeServerProcessId: { args: ["i64", "ptr"], returns: "i32" },
  PeekNamedPipe: { args: ["i64", "ptr", "u32", "ptr", "ptr", "ptr"], returns: "i32" },
  ReadFile: { args: ["i64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
  WriteFile: { args: ["i64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
  CloseHandle: { args: ["i64"], returns: "i32" },
  GetLastError: { args: [], returns: "u32" },
});

export async function connect(name: string, expectedPid: number, signal: AbortSignal) {
  const wide = Buffer.from(`${name}\0`, "utf16le");
  let handle: bigint;
  while (true) {
    signal.throwIfAborted();
    // Identification prevents a pipe server from impersonating the client. No overlapped I/O remains pending on close.
    handle = kernel.symbols.CreateFileW(wide, 0xc0000000, 0, null, 3, 0x00110000, 0n);
    if (handle !== -1n) break;
    const error = kernel.symbols.GetLastError();
    if (error !== 231) throw new Error(`Opening the PTY pipe failed (Win32 ${error}).`);
    await Bun.sleep(10);
  }

  const pid = Buffer.alloc(4);
  if (!kernel.symbols.GetNamedPipeServerProcessId(handle, pid) || pid.readUInt32LE() !== expectedPid) {
    kernel.symbols.CloseHandle(handle);
    throw new Error("The named-pipe server is not the spawned PTY daemon.");
  }

  let closed = false;
  return {
    write(bytes: Buffer, signal: AbortSignal) {
      const written = Buffer.alloc(4);
      let offset = 0;
      // The verified daemon reads each complete request before dispatching it. Chunk writes to its pipe buffer size.
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const chunk = bytes.subarray(offset, offset + 65_536);
        if (!kernel.symbols.WriteFile(handle, chunk, chunk.length, written, null)) throw failure("Writing the PTY pipe");
        offset += written.readUInt32LE();
      }
    },
    async read(length: number, signal: AbortSignal) {
      const bytes = Buffer.allocUnsafe(length);
      const available = Buffer.alloc(4);
      const received = Buffer.alloc(4);
      let offset = 0;
      while (offset < length) {
        signal.throwIfAborted();
        if (!kernel.symbols.PeekNamedPipe(handle, null, 0, null, available, null)) throw failure("Reading the PTY pipe");
        const count = Math.min(available.readUInt32LE(), length - offset);
        if (count === 0) {
          await Bun.sleep(10);
          continue;
        }
        // Only consume bytes already present, so ReadFile cannot block the OpenCode event loop.
        if (!kernel.symbols.ReadFile(handle, bytes.subarray(offset), count, received, null)) throw failure("Reading the PTY pipe");
        offset += received.readUInt32LE();
      }
      return bytes;
    },
    close() {
      if (closed) return;
      closed = true;
      kernel.symbols.CloseHandle(handle);
    },
  };
}

function failure(operation: string) {
  return new Error(`${operation} failed (Win32 ${kernel.symbols.GetLastError()}). The operation may have run; inspect before retrying.`);
}

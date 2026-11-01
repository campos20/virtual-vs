/**
 * Typed access to the Tauri APIs the desktop build uses. Tauri injects them
 * as `window.__TAURI__` (`app.withGlobalTauri` in tauri.conf.json), so there
 * is no npm dependency for the shell itself.
 */

interface DialogFilter {
  name: string;
  extensions: string[];
}

interface TauriGlobal {
  core: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    convertFileSrc(path: string, protocol?: string): string;
  };
  event: {
    listen<T>(
      event: string,
      handler: (event: { payload: T }) => void,
    ): Promise<() => void>;
  };
  dialog: {
    open(options: {
      multiple?: boolean;
      directory?: boolean;
      filters?: DialogFilter[];
      title?: string;
    }): Promise<string | string[] | null>;
    save(options: {
      defaultPath?: string;
      filters?: DialogFilter[];
      title?: string;
    }): Promise<string | null>;
    ask(
      message: string,
      options?: { title?: string; kind?: "info" | "warning" | "error" },
    ): Promise<boolean>;
    message(
      message: string,
      options?: { title?: string; kind?: "info" | "warning" | "error" },
    ): Promise<void>;
  };
}

export function tauri(): TauriGlobal {
  const api = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  if (!api) {
    throw new Error(
      "The desktop build must run inside the Virtual VS desktop app (Tauri).",
    );
  }
  return api;
}

export function invoke<T = void>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return tauri().core.invoke<T>(command, args);
}

export function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  return tauri().event.listen<T>(event, (e) => handler(e.payload));
}

/** Absolute filesystem path for a `file://` URI (or a path, unchanged). */
export function uriToPath(uriOrPath: string): string {
  if (!uriOrPath.startsWith("file://")) return uriOrPath;
  let path = uriOrPath.slice("file://".length);
  // file:///C:/x -> C:/x on Windows; file:///Users/x -> /Users/x elsewhere.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

/** `file://` URI for an absolute path, percent-encoding each segment. */
export function pathToUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((segment) =>
      /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment),
    )
    .join("/");
  return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

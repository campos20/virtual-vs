/**
 * Desktop replacement for `expo-file-system` (wired in metro.config.js for
 * the web/desktop build only). Implements the subset of the File/Directory
 * API the mobile storage code uses, with the same synchronous semantics,
 * on top of the `vvsfs://` protocol in desktop/src-tauri/src/fs.rs.
 *
 * Every call is a synchronous XMLHttpRequest straight to disk - no cache to
 * drift out of step with the files. Paths follow the native conventions the
 * mobile code relies on: `uri` is `file:///...`, directories end in `/`, and
 * `list()` returns real `File`/`Directory` instances (code uses instanceof).
 */
import { pathToUri, tauri, uriToPath } from "../tauri";

let protocolBase: string | null = null;

function base(): string {
  if (!protocolBase) {
    // vvsfs://localhost on macOS/Linux, http://vvsfs.localhost on Windows.
    protocolBase = tauri().core.convertFileSrc("", "vvsfs").replace(/\/+$/, "");
  }
  return protocolBase;
}

interface Reply {
  status: number;
  bytes: Uint8Array<ArrayBuffer>;
}

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

function send(
  op: string,
  params: Record<string, string | number | boolean> = {},
  body?: Uint8Array,
): Reply {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const xhr = new XMLHttpRequest();
  xhr.open(body ? "POST" : "GET", `${base()}/${op}?${query}`, false);
  // Synchronous requests can't use responseType = "arraybuffer"; the
  // x-user-defined charset maps every byte to one char code instead.
  xhr.overrideMimeType("text/plain; charset=x-user-defined");
  xhr.send(body ? (body as unknown as XMLHttpRequestBodyInit) : null);

  const text = xhr.responseText ?? "";
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  if (xhr.status === 0) {
    throw new Error(`File system unavailable (${op})`);
  }
  if (xhr.status >= 400) {
    throw new Error(decoder.decode(bytes) || `File operation ${op} failed`);
  }
  return { status: xhr.status, bytes };
}

function sendJson<T>(
  op: string,
  params: Record<string, string | number | boolean> = {},
  body?: Uint8Array,
): T {
  return JSON.parse(decoder.decode(send(op, params, body).bytes)) as T;
}

interface Stat {
  exists: boolean;
  isDirectory: boolean;
  size: number | null;
  modificationTime: number | null;
}

function stat(path: string): Stat {
  return sendJson<Stat>("stat", { path });
}

function normalize(path: string): string {
  let p = path.replace(/\\/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

function resolvePath(parts: (string | File | Directory)[]): string {
  if (parts.length === 0) throw new Error("A path is required");
  const [first, ...rest] = parts;
  let path =
    typeof first === "string" ? uriToPath(first) : (first as Entry).path;
  for (const part of rest) {
    const segment =
      typeof part === "string" ? part : (part as Entry).path.split("/").pop();
    path = `${normalize(path)}/${String(segment).replace(/^\/+/, "")}`;
  }
  return normalize(path);
}

function bytesFromContent(
  content: string | Uint8Array,
  encoding?: string,
): Uint8Array {
  if (typeof content !== "string") return content;
  if (encoding === "base64") {
    const binary = atob(content);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return encoder.encode(content);
}

abstract class Entry {
  path: string;

  constructor(...uris: (string | File | Directory)[]) {
    this.path = resolvePath(uris);
  }

  get name(): string {
    return this.path.split("/").pop() ?? "";
  }

  get parentDirectory(): Directory {
    const parent = this.path.slice(0, this.path.lastIndexOf("/")) || "/";
    return new Directory(parent);
  }

  delete(): void {
    send("delete", { path: this.path }, new Uint8Array());
  }

  protected destination(target: File | Directory): string {
    return target instanceof Directory
      ? `${target.path}/${this.name}`
      : target.path;
  }

  copy(target: File | Directory): void {
    send(
      "copy",
      { from: this.path, to: this.destination(target) },
      new Uint8Array(),
    );
  }

  move(target: File | Directory): void {
    const to = this.destination(target);
    send("move", { from: this.path, to }, new Uint8Array());
    this.path = to;
  }

  rename(newName: string): void {
    const to = `${this.parentDirectory.path}/${newName}`;
    send("move", { from: this.path, to }, new Uint8Array());
    this.path = to;
  }
}

export enum FileMode {
  ReadWrite = "rw",
  ReadOnly = "r",
  WriteOnly = "w",
  Append = "wa",
  Truncate = "wt",
}

export enum EncodingType {
  UTF8 = "utf8",
  Base64 = "base64",
}

export class FileHandle {
  private open = true;

  constructor(private readonly id: number) {}

  private ensureOpen(): void {
    if (!this.open) throw new Error("File handle is closed");
  }

  readBytes(length: number): Uint8Array<ArrayBuffer> {
    this.ensureOpen();
    return send("handle-read", { handle: this.id, length }, new Uint8Array())
      .bytes;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensureOpen();
    send("handle-write", { handle: this.id }, bytes);
  }

  get offset(): number | null {
    if (!this.open) return null;
    return sendJson<{ offset: number }>("handle-info", { handle: this.id })
      .offset;
  }

  set offset(value: number | null) {
    this.ensureOpen();
    send(
      "handle-seek",
      { handle: this.id, offset: value ?? 0 },
      new Uint8Array(),
    );
  }

  get size(): number | null {
    if (!this.open) return null;
    return sendJson<{ size: number | null }>("handle-info", { handle: this.id })
      .size;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    send("handle-close", { handle: this.id }, new Uint8Array());
  }
}

export class File extends Entry {
  get uri(): string {
    return pathToUri(this.path);
  }

  get exists(): boolean {
    const s = stat(this.path);
    return s.exists && !s.isDirectory;
  }

  get size(): number | null {
    return stat(this.path).size;
  }

  get modificationTime(): number | null {
    return stat(this.path).modificationTime;
  }

  get extension(): string {
    const dot = this.name.lastIndexOf(".");
    return dot > 0 ? this.name.slice(dot) : "";
  }

  info(): { exists: boolean; uri: string; size?: number } {
    const s = stat(this.path);
    return { exists: s.exists, uri: this.uri, size: s.size ?? undefined };
  }

  create(options: { intermediates?: boolean; overwrite?: boolean } = {}): void {
    send(
      "create-file",
      {
        path: this.path,
        intermediates: !!options.intermediates,
        overwrite: !!options.overwrite,
      },
      new Uint8Array(),
    );
  }

  write(
    content: string | Uint8Array,
    options: { encoding?: string; append?: boolean } = {},
  ): void {
    send(
      "write",
      { path: this.path, append: !!options.append },
      bytesFromContent(content, options.encoding),
    );
  }

  bytesSync(): Uint8Array<ArrayBuffer> {
    return send("read", { path: this.path }).bytes;
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.bytesSync();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytesSync().buffer;
  }

  textSync(): string {
    return decoder.decode(this.bytesSync());
  }

  async text(): Promise<string> {
    return this.textSync();
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.textSync());
  }

  open(mode: FileMode = FileMode.ReadWrite): FileHandle {
    const { handle } = sendJson<{ handle: number }>(
      "open",
      { path: this.path, mode },
      new Uint8Array(),
    );
    return new FileHandle(handle);
  }
}

export class Directory extends Entry {
  get uri(): string {
    return `${pathToUri(this.path)}/`;
  }

  get exists(): boolean {
    const s = stat(this.path);
    return s.exists && s.isDirectory;
  }

  info(): { exists: boolean; uri: string; files?: string[] } {
    const exists = this.exists;
    return {
      exists,
      uri: this.uri,
      files: exists ? this.list().map((e) => e.name) : undefined,
    };
  }

  create(
    options: {
      intermediates?: boolean;
      overwrite?: boolean;
      idempotent?: boolean;
    } = {},
  ): void {
    send(
      "mkdir",
      {
        path: this.path,
        intermediates: !!options.intermediates,
        overwrite: !!options.overwrite,
        idempotent: !!options.idempotent,
      },
      new Uint8Array(),
    );
  }

  list(): (Directory | File)[] {
    return sendJson<{ name: string; isDirectory: boolean }[]>("list", {
      path: this.path,
    }).map((entry) =>
      entry.isDirectory
        ? new Directory(this.path, entry.name)
        : new File(this.path, entry.name),
    );
  }

  createFile(name: string, _mimeType: string | null): File {
    const file = new File(this, name);
    file.create();
    return file;
  }

  createDirectory(name: string): Directory {
    const directory = new Directory(this, name);
    directory.create();
    return directory;
  }
}

let roots: { document: Directory; cache: Directory } | null = null;

function loadRoots(): { document: Directory; cache: Directory } {
  if (!roots) {
    const paths = sendJson<{ document: string; cache: string }>("paths");
    roots = {
      document: new Directory(paths.document),
      cache: new Directory(paths.cache),
    };
  }
  return roots;
}

export class Paths {
  static get document(): Directory {
    return loadRoots().document;
  }

  static get cache(): Directory {
    return loadRoots().cache;
  }
}

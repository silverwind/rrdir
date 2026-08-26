import {readdir, stat, lstat} from "node:fs/promises";
import {readdir as readdirCb, stat as statCb, lstat as lstatCb, readdirSync, statSync, lstatSync} from "node:fs";
import {sep, resolve, isAbsolute} from "node:path";
import type {Stats} from "node:fs";

type DirentLike = {
  name: string | Uint8Array,
  isFile(): boolean,
  isDirectory(): boolean,
  isSymbolicLink(): boolean,
};

const decoder = new TextDecoder();
const toString = decoder.decode.bind(decoder);
const sepUint8Array = new TextEncoder().encode(sep);
const isWin = sep === "\\";
// 0x2F is "/", 0x5C is "\" which separates only on windows, elsewhere it is a valid filename byte
const isSep = (code: number): boolean => code === 0x2F || (isWin && code === 0x5C);
const trailingSep = isWin ? /[/\\]+$/ : /\/+$/;

/** A directory path, either as a string or a Uint8Array for raw byte paths. */
export type Dir = string | Uint8Array;

/** Options for `rrdir`, `rrdirAsync`, and `rrdirSync`. */
export type RRDirOpts = {
  /** Whether to throw immediately when reading an entry fails. Default: `false`. */
  strict?: boolean,
  /** Whether to include `entry.stats`. Will reduce performance. Default: `false`. */
  stats?: boolean,
  /** Whether to follow symlinks for both recursion and `stat` calls. Default: `false`. */
  followSymlinks?: boolean,
  /** Path globs to include, e.g. `["**.map"]`. Supports `*`, `**` and `?`. Default: `undefined`. */
  include?: Array<string>,
  /** Path globs to exclude, e.g. `["**.js"]`. Supports `*`, `**` and `?`. Excluding a directory prunes its subtree. Default: `undefined`. */
  exclude?: Array<string>,
  /** Whether `include` and `exclude` match case-insensitively. Default: `false`. */
  insensitive?: boolean,
};

type Matcher = ((path: string) => boolean) | null;

type Pending<T> = {path: T, isIncluded: boolean, isDir: boolean, isSym: boolean, stats: Promise<Stats | Error> | undefined};

type InternalOpts = {
  includeMatcher: Matcher,
  excludeMatcher: Matcher,
  isBuffer: boolean,
  followSymlinks: boolean,
  needStats: boolean,
  strict: boolean,
  readdirOpts: any,
  statFn: typeof stat,
  statCbFn: typeof statCb,
  statSyncFn: typeof statSync,
};

/** A directory entry returned by `rrdir`, `rrdirAsync`, and `rrdirSync`. */
export type Entry<T = Dir> = {
  /** The path to the entry, will be relative if `dir` is given relative. If `dir` is a `Uint8Array`, this will be too. Always present. */
  path: T,
  /** Boolean indicating whether the entry is a directory. `undefined` on error. */
  directory?: boolean,
  /** Boolean indicating whether the entry is a symbolic link. `undefined` on error. */
  symlink?: boolean,
  /** A [`fs.stats`](https://nodejs.org/api/fs.html#fs_class_fs_stats) object, present when `options.stats` is set. `undefined` on error. */
  stats?: Stats,
  /** Any error encountered while reading this entry. `undefined` on success. */
  err?: Error,
};

function makeDirPrefix(dir: Dir, isBuffer: boolean): string | Uint8Array {
  if (isBuffer) {
    const dirBytes = dir as Uint8Array;
    if (dirBytes.length === 1 && dirBytes[0] === 0x2E) return dirBytes.subarray(0, 0);
    if (isSep(dirBytes[dirBytes.length - 1])) return dirBytes; // root already ends in a separator
    const result = new Uint8Array(dirBytes.length + sepUint8Array.length);
    result.set(dirBytes, 0);
    result.set(sepUint8Array, dirBytes.length);
    return result;
  }
  const d = dir as string;
  if (d === ".") return "";
  if (isSep(d.charCodeAt(d.length - 1))) return d; // root already ends in a separator
  return d + sep;
}

function makePath<T extends Dir>(name: string | Uint8Array, prefix: string | Uint8Array, isBuffer: boolean): T {
  if (isBuffer) {
    const prefixBytes = prefix as Uint8Array;
    if (prefixBytes.length === 0) return name as T;
    const nameBytes = name as Uint8Array;
    const result = new Uint8Array(prefixBytes.length + nameBytes.length);
    result.set(prefixBytes, 0);
    result.set(nameBytes, prefixBytes.length);
    return result as T;
  }
  return ((prefix as string) + (name as string)) as T;
}

function build<T extends Dir>(path: T, directory: boolean, symlink: boolean, stats: Stats | undefined, needStats: boolean): Entry<T> {
  if (needStats) return {path, directory, symlink, stats};
  return {path, directory, symlink};
}

// resolves instead of rejecting, so abandoning the yield loop cannot strand an unhandled rejection
async function statOrError(statFn: typeof stat, path: Buffer): Promise<Stats | Error> {
  try {
    return await statFn(path);
  } catch (err) {
    return err as Error;
  }
}

function globToRegex(pattern: string, insensitive: boolean): RegExp {
  pattern = pattern.replace(/\\/g, "/");
  const endsWithDoubleStar = pattern.endsWith("/**");

  let regex = pattern.replace(/\/\*\*(?=\/)|\*\*|\*|\?|[.+^${}()|[\]\\]/g, m => {
    if (m === "/**") return "(?:/.*)?"; // a middle "/**/" also matches zero segments
    if (m === "**") return ".*";
    if (m === "*") return "[^/]*";
    if (m === "?") return "[^/]";
    return `\\${m}`;
  });

  if (endsWithDoubleStar) regex = `${regex.slice(0, -3)}(?:/.*)?`; // a trailing "/**" also matches the directory itself

  return new RegExp(`^${regex}$`, insensitive ? "i" : "");
}

function createMatcher(patterns: Array<string> | undefined, insensitive: boolean, pathIsAbsolute: boolean): Matcher {
  if (!patterns?.length) return null;

  const regexes = patterns.map(pattern => globToRegex(pattern, insensitive));
  const prefix = pathIsAbsolute ? "" : resolve(".") + sep;
  if (sep === "\\") {
    return (path: string) => {
      const p = (prefix + path).replace(/\\/g, "/");
      for (const re of regexes) if (re.test(p)) return true;
      return false;
    };
  }
  return (path: string) => {
    const p = prefix + path;
    for (const re of regexes) if (re.test(p)) return true;
    return false;
  };
}

function initOpts<T extends Dir>(dir: T, opts: RRDirOpts): {dir: T, internalOpts: InternalOpts} {
  // strip trailing separators, but never reduce a filesystem root ("/", "C:\", "\\server\share\")
  // to an empty or drive-relative path, which would make readdir fail or read the wrong directory
  if (dir instanceof Uint8Array) {
    let end = dir.length;
    while (end > 1 && isSep(dir[end - 1])) end--;
    if (isWin && end === 2 && dir[1] === 0x3A && dir.length > 2) end = 3; // keep the separator on a drive root "C:\"
    if (end < dir.length) dir = dir.subarray(0, end) as T;
  } else if (trailingSep.test(dir)) {
    const stripped = dir.replace(trailingSep, "");
    if (stripped === "") dir = dir.slice(0, 1) as T; // bare root like "/" or "\"
    else if (isWin && /^[a-zA-Z]:$/.test(stripped)) dir = `${stripped}${sep}` as T; // drive root "C:\"
    else dir = stripped as T;
  }
  const isBuffer = dir instanceof Uint8Array;
  const insensitive = Boolean(opts.insensitive);
  const pathIsAbsolute = dir instanceof Uint8Array ? isAbsolute(toString(dir)) : isAbsolute(dir);
  const includeMatcher = createMatcher(opts.include, insensitive, pathIsAbsolute);
  const excludeMatcher = createMatcher(opts.exclude, insensitive, pathIsAbsolute);
  const followSymlinks = Boolean(opts.followSymlinks);
  return {dir, internalOpts: {
    includeMatcher,
    excludeMatcher,
    isBuffer,
    followSymlinks,
    needStats: Boolean(opts.stats),
    strict: Boolean(opts.strict),
    readdirOpts: {encoding: isBuffer ? "buffer" : "utf8", withFileTypes: true},
    statFn: followSymlinks ? stat : lstat,
    statCbFn: followSymlinks ? statCb : lstatCb,
    statSyncFn: followSymlinks ? statSync : lstatSync,
  }};
}

/** Recursively read a directory via async iterator. Holds only one directory level in memory at a time. */
export async function* rrdir<T extends Dir>(dir: T, opts: RRDirOpts = {}): AsyncGenerator<Entry<T>> {
  const init = initOpts(dir, opts);
  const {includeMatcher, excludeMatcher, isBuffer, followSymlinks, needStats, strict, readdirOpts, statFn} = init.internalOpts;
  dir = init.dir;

  // BFS with parallel reads per level exploits I/O concurrency via Promise.all.
  // reads stays index-aligned with currentLevel; a failed read resolves to its Error.
  let currentLevel: Array<T> = [dir];
  while (currentLevel.length > 0) {
    const reads = await Promise.all(currentLevel.map(async d => {
      try {
        return await readdir(d as Buffer, readdirOpts);
      } catch (err) {
        return err as Error;
      }
    }));
    const nextLevel: Array<T> = [];
    for (let i = 0; i < reads.length; i++) {
      const r = reads[i];
      const currentDir = currentLevel[i];
      if (r instanceof Error) {
        if (strict) throw r;
        yield {path: currentDir, err: r};
        continue;
      }
      const dirents = r as unknown as Array<DirentLike>;
      const prefix = makeDirPrefix(currentDir, isBuffer);
      // a directory's stat calls are all dispatched before any is awaited, awaiting inline serializes the syscalls
      let deferred: Array<Pending<T>> | undefined;
      for (const dirent of dirents) {
        const path = makePath<T>(dirent.name, prefix, isBuffer);

        let isIncluded = true;
        if (excludeMatcher || includeMatcher) {
          const sp = isBuffer ? toString(path as Uint8Array) : path as string;
          if (excludeMatcher?.(sp)) continue;
          if (includeMatcher) isIncluded = includeMatcher(sp);
        }

        let isDir = false;
        let isSym = false;
        if (!dirent.isFile()) {
          isDir = dirent.isDirectory();
          if (!isDir) isSym = dirent.isSymbolicLink();
        }

        let stats: Promise<Stats | Error> | undefined;
        if ((followSymlinks && isSym) || (isIncluded && needStats)) {
          stats = statOrError(statFn, path as Buffer);
        } else if (!deferred) { // nothing is pending yet, so yielding now keeps readdir order
          if (isIncluded) yield build(path, isDir, isSym && !followSymlinks, undefined, needStats);
          if (isDir) nextLevel.push(path);
          continue;
        }
        (deferred ??= []).push({path, isIncluded, isDir, isSym, stats});
      }

      for (const {path, isIncluded, isDir, isSym, stats: pending} of deferred ?? []) {
        let stats: Stats | undefined;
        let errEntry: Entry<T> | undefined;

        if (pending) {
          const result = await pending;
          if (result instanceof Error) {
            if (strict) throw result;
            if (isIncluded) errEntry = {path, err: result};
          } else {
            stats = result;
          }
        }

        const directory = stats ? stats.isDirectory() : isDir;
        if (isIncluded) yield errEntry ?? build(path, directory, isSym && !followSymlinks, stats, needStats);
        if (directory) nextLevel.push(path);
      }
    }
    currentLevel = nextLevel;
  }
}

/** Recursively read a directory, returning all entries as an array. Memory usage is `O(n)`. */
export function rrdirAsync<T extends Dir>(dir: T, opts: RRDirOpts = {}): Promise<Array<Entry<T>>> {
  return new Promise((resolve, reject) => {
    const init = initOpts(dir, opts);
    const results: Array<Entry<T>> = [];
    rrdirAsyncCb(init.dir, init.internalOpts, results, err => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// Callback-based traversal: avoids Promise/microtask overhead per readdir/stat,
// and dispatches stats in parallel (the awaited fs/promises version serialized them).
function rrdirAsyncCb<T extends Dir>(dir: T, internalOpts: InternalOpts, results: Array<Entry<T>>, done: (err?: Error) => void): void {
  const {includeMatcher, excludeMatcher, isBuffer, followSymlinks, needStats, strict, readdirOpts, statCbFn} = internalOpts;

  readdirCb(dir as Buffer, readdirOpts, (err, direntsRaw) => {
    if (err) {
      if (strict) return done(err);
      results.push({path: dir, err});
      return done();
    }
    const dirents = direntsRaw as unknown as Array<DirentLike>;
    if (!dirents.length) return done();

    const prefix = makeDirPrefix(dir, isBuffer);
    const pendingDirs: Array<T> = [];
    let pendingStats = 0;
    let firstErr: Error | undefined;
    let finished = false;

    const tryDescend = (): void => {
      if (finished) return;
      if (firstErr) {
        finished = true;
        return done(firstErr);
      }
      if (pendingStats > 0) return;
      finished = true;
      if (!pendingDirs.length) return done();
      let remaining = pendingDirs.length;
      const onChildDone = (err?: Error) => {
        if (firstErr) return; // strict already reported, remaining siblings are moot
        if (err) {
          firstErr = err;
          return done(err);
        }
        if (--remaining === 0) done();
      };
      for (const p of pendingDirs) rrdirAsyncCb(p, internalOpts, results, onChildDone);
    };

    for (const dirent of dirents) {
      const path = makePath<T>(dirent.name, prefix, isBuffer);

      let isIncluded = true;
      if (excludeMatcher || includeMatcher) {
        const sp = isBuffer ? toString(path as Uint8Array) : path as string;
        if (excludeMatcher?.(sp)) continue;
        if (includeMatcher) isIncluded = includeMatcher(sp);
      }

      let isDir = false;
      let isSym = false;
      if (!dirent.isFile()) {
        isDir = dirent.isDirectory();
        if (!isDir) isSym = dirent.isSymbolicLink();
      }

      if ((followSymlinks && isSym) || (isIncluded && needStats)) {
        pendingStats++;
        statCbFn(path as Buffer, (statErr, stats) => {
          if (statErr && strict) {
            firstErr ??= statErr;
          } else {
            const directory = stats ? stats.isDirectory() : isDir;
            if (isIncluded) results.push(statErr ? {path, err: statErr} : build(path, directory, isSym && !followSymlinks, stats, needStats));
            if (directory) pendingDirs.push(path);
          }
          pendingStats--;
          tryDescend();
        });
      } else {
        if (isIncluded) results.push(build(path, isDir, isSym && !followSymlinks, undefined, needStats));
        if (isDir) pendingDirs.push(path);
      }
    }
    tryDescend();
  });
}

/** Synchronously recursively read a directory, returning all entries as an array. Memory usage is `O(n)`. */
export function rrdirSync<T extends Dir>(dir: T, opts: RRDirOpts = {}): Array<Entry<T>> {
  const init = initOpts(dir, opts);
  const results: Array<Entry<T>> = [];
  rrdirSyncInner(init.dir, init.internalOpts, results);
  return results;
}

function rrdirSyncInner<T extends Dir>(dir: T, internalOpts: InternalOpts, results: Array<Entry<T>>): void {
  const {includeMatcher, excludeMatcher, isBuffer, followSymlinks, needStats, strict, readdirOpts, statSyncFn} = internalOpts;
  const stack: Array<T> = [dir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    let dirents: Array<DirentLike> = [];
    try {
      dirents = readdirSync(currentDir as Buffer, readdirOpts) as unknown as Array<DirentLike>;
    } catch (err) {
      if (strict) throw err;
      results.push({path: currentDir, err: err as Error});
      continue;
    }
    if (!dirents.length) continue;

    const prefix = makeDirPrefix(currentDir, isBuffer);
    for (const dirent of dirents) {
      const path = makePath<T>(dirent.name, prefix, isBuffer);

      let isIncluded = true;
      if (excludeMatcher || includeMatcher) {
        const sp = isBuffer ? toString(path as Uint8Array) : path as string;
        if (excludeMatcher?.(sp)) continue;
        if (includeMatcher) isIncluded = includeMatcher(sp);
      }

      let isDir = false;
      let isSym = false;
      if (!dirent.isFile()) {
        isDir = dirent.isDirectory();
        if (!isDir) isSym = dirent.isSymbolicLink();
      }
      let stats: Stats | undefined;
      let errEntry: Entry<T> | undefined;

      if ((followSymlinks && isSym) || (isIncluded && needStats)) {
        try {
          stats = statSyncFn(path as Buffer);
        } catch (err) {
          if (strict) throw err;
          if (isIncluded) errEntry = {path, err: err as Error};
        }
      }

      const directory = stats ? stats.isDirectory() : isDir;
      if (isIncluded) results.push(errEntry ?? build(path, directory, isSym && !followSymlinks, stats, needStats));
      if (directory) stack.push(path);
    }
  }
}

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
  /** Path globs to include, e.g. `["**.map"]`. Default: `undefined`. */
  include?: Array<string>,
  /** Path globs to exclude, e.g. `["**.js"]`. Default: `undefined`. */
  exclude?: Array<string>,
  /** Whether `include` and `exclude` match case-insensitively. Default: `false`. */
  insensitive?: boolean,
};

type Matcher = ((path: string) => boolean) | null;

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
    const result = new Uint8Array(dirBytes.length + sepUint8Array.length);
    result.set(dirBytes, 0);
    result.set(sepUint8Array, dirBytes.length);
    return result;
  }
  return (dir as string) === "." ? "" : (dir as string) + sep;
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

function globToRegex(pattern: string, insensitive: boolean): RegExp {
  pattern = pattern.replace(/\\/g, "/");
  const endsWithDoubleStar = pattern.endsWith("/**");

  let regex = pattern.replace(/\*\*|\*|[.+?^${}()|[\]\\]/g, m => {
    if (m === "**") return ".*";
    if (m === "*") return "[^/]*";
    return `\\${m}`;
  });

  if (endsWithDoubleStar) {
    regex = regex.slice(0, -3);
    regex = `^${regex}(?:/.*)?$`;
  } else {
    regex = `^${regex}$`;
  }

  return new RegExp(regex, insensitive ? "i" : "");
}

function createMatcher(patterns: Array<string> | undefined, insensitive: boolean, pathIsAbsolute: boolean): Matcher {
  if (!patterns?.length) return null;

  const regexes = patterns.map(pattern => globToRegex(pattern, insensitive));
  const prefix = pathIsAbsolute ? "" : resolve(".") + sep;
  const len = regexes.length;
  if (sep === "\\") {
    return (path: string) => {
      const p = (prefix + path).replace(/\\/g, "/");
      for (let i = 0; i < len; i++) if (regexes[i].test(p)) return true;
      return false;
    };
  }
  return (path: string) => {
    const p = prefix + path;
    for (let i = 0; i < len; i++) if (regexes[i].test(p)) return true;
    return false;
  };
}

function initOpts<T extends Dir>(dir: T, opts: RRDirOpts): {dir: T, internalOpts: InternalOpts} {
  if (dir instanceof Uint8Array) {
    const last = dir[dir.length - 1];
    if (last === 0x2F || last === 0x5C) dir = dir.subarray(0, -1) as T;
  } else if (/[/\\]$/.test(dir)) {
    dir = dir.substring(0, dir.length - 1) as T;
  }
  const isBuffer = dir instanceof Uint8Array;
  const insensitive = opts.insensitive || false;
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

/** Recursively read a directory via async iterator. Memory usage is `O(1)`. */
export async function* rrdir<T extends Dir>(dir: T, opts: RRDirOpts = {}): AsyncGenerator<Entry<T>> {
  const init = initOpts(dir, opts);
  const {includeMatcher, excludeMatcher, isBuffer, followSymlinks, needStats, strict, readdirOpts, statFn} = init.internalOpts;
  dir = init.dir;

  // BFS with parallel reads per level exploits I/O concurrency via Promise.all.
  let currentLevel: Array<T> = [dir];
  while (currentLevel.length > 0) {
    const reads = await Promise.all(currentLevel.map(d =>
      readdir(d as Buffer, readdirOpts).then(
        dirents => ({dir: d, dirents: dirents as unknown as Array<DirentLike>}),
        (err: unknown) => ({dir: d, err: err as Error}),
      )
    ));
    const nextLevel: Array<T> = [];
    for (const r of reads) {
      if ("err" in r) {
        if (strict) throw r.err;
        yield {path: r.dir, err: r.err};
        continue;
      }
      const prefix = makeDirPrefix(r.dir, isBuffer);
      for (const dirent of r.dirents) {
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
            stats = await statFn(path as Buffer);
          } catch (err) {
            if (strict) throw err;
            if (isIncluded) errEntry = {path, err: err as Error};
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
  const init = initOpts(dir, opts);
  const results: Array<Entry<T>> = [];
  return new Promise((resolve, reject) => {
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
    let direntsProcessed = false;
    let firstErr: Error | undefined;
    let finished = false;

    const tryDescend = (): void => {
      if (finished) return;
      if (firstErr) {
        finished = true;
        return done(firstErr);
      }
      if (!direntsProcessed || pendingStats > 0) return;
      finished = true;
      if (!pendingDirs.length) return done();
      let remaining = pendingDirs.length;
      const onChildDone = (err?: Error) => {
        if (err && !firstErr) firstErr = err;
        if (--remaining === 0) done(firstErr);
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
          if (statErr) {
            if (strict) firstErr ??= statErr;
            else if (isIncluded) results.push({path, err: statErr});
          } else {
            const directory = stats.isDirectory();
            if (isIncluded) results.push(build(path, directory, isSym && !followSymlinks, stats, needStats));
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
    direntsProcessed = true;
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

import {readdir, stat, lstat} from "node:fs/promises";
import {readdirSync, statSync, lstatSync} from "node:fs";
import {sep, resolve, isAbsolute} from "node:path";
import type {Stats, Dirent} from "node:fs";

const decoder = new TextDecoder();
const toString = decoder.decode.bind(decoder);
const sepUint8Array = new TextEncoder().encode(sep);

/** The internal encoding used for path operations. */
type Encoding = "utf8" | "buffer";
/** A directory path, either as a string or a Buffer for raw byte paths. */
export type Dir = string | Buffer;

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
  encoding: Encoding,
  followSymlinks: boolean,
  needStats: boolean,
  strict: boolean,
  readdirOpts: any,
  statFn: typeof stat,
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

function makeDirPrefix(dir: Dir, encoding: Encoding): string | Uint8Array {
  if (encoding === "buffer") {
    const dirBuf = dir as unknown as Uint8Array;
    if (dirBuf.length === 1 && dirBuf[0] === 0x2E) return dirBuf.subarray(0, 0);
    const result = new Uint8Array(dirBuf.length + sepUint8Array.length);
    result.set(dirBuf, 0);
    result.set(sepUint8Array, dirBuf.length);
    return result;
  }
  return (dir as string) === "." ? "" : (dir as string) + sep;
}

function makePath<T extends Dir>(name: string | Uint8Array, prefix: string | Uint8Array, encoding: Encoding): T {
  if (encoding === "buffer") {
    const prefixBuf = prefix as Uint8Array;
    if (prefixBuf.length === 0) return name as T;
    const nameBuf = name as Uint8Array;
    const result = new Uint8Array(prefixBuf.length + nameBuf.length);
    result.set(prefixBuf, 0);
    result.set(nameBuf, prefixBuf.length);
    return result as T;
  }
  return ((prefix as string) + (name as string)) as T;
}

function build<T extends Dir>(path: T, isDir: boolean, isSym: boolean, stats: Stats | undefined, needStats: boolean): Entry<T> {
  const directory = stats ? stats.isDirectory() : isDir;
  const symlink = stats ? stats.isSymbolicLink() : isSym;
  if (needStats) return {path, directory, symlink, stats};
  return {path, directory, symlink};
}

// Convert a glob pattern to a regular expression
function globToRegex(pattern: string, insensitive: boolean): RegExp {
  pattern = pattern.replace(/\\/g, "/");
  const endsWithDoubleStar = pattern.endsWith("/**");

  // Single-pass: match ** before *, escape regex special chars
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

// Create a matcher function from an array of glob patterns
function createMatcher(patterns: Array<string> | undefined, insensitive: boolean, pathIsAbsolute: boolean): Matcher {
  if (!patterns?.length) return null;

  const regexes = patterns.map(pattern => globToRegex(pattern, insensitive));
  const needsNormalize = sep === "\\";
  const prefix = pathIsAbsolute ? "" : resolve(".") + sep;
  return (path: string) => {
    const p = prefix ? prefix + path : path;
    return regexes.some(regex => regex.test(needsNormalize ? p.replace(/\\/g, "/") : p));
  };
}

function initOpts<T extends Dir>(dir: T, opts: RRDirOpts): {dir: T, internalOpts: InternalOpts} {
  if (typeof dir === "string" && /[/\\]$/.test(dir)) {
    dir = dir.substring(0, dir.length - 1) as T;
  }
  const encoding: Encoding = dir instanceof Uint8Array ? "buffer" : "utf8";
  const insensitive = opts.insensitive || false;
  const pathIsAbsolute = typeof dir === "string" ? isAbsolute(dir) : false;
  const includeMatcher = createMatcher(opts.include, insensitive, pathIsAbsolute);
  const excludeMatcher = createMatcher(opts.exclude, insensitive, pathIsAbsolute);
  const followSymlinks = Boolean(opts.followSymlinks);
  return {dir, internalOpts: {
    includeMatcher,
    excludeMatcher,
    encoding,
    followSymlinks,
    needStats: Boolean(opts.stats),
    strict: Boolean(opts.strict),
    readdirOpts: {encoding, withFileTypes: true},
    statFn: followSymlinks ? stat : lstat,
    statSyncFn: followSymlinks ? statSync : lstatSync,
  }};
}

/** Recursively read a directory via async iterator. Memory usage is `O(1)`. */
export async function* rrdir<T extends Dir>(dir: T, opts: RRDirOpts = {}): AsyncGenerator<Entry<T>> {
  const init = initOpts(dir, opts);
  const {includeMatcher, excludeMatcher, encoding, followSymlinks, needStats, strict, readdirOpts, statFn} = init.internalOpts;
  dir = init.dir;

  // BFS with parallel reads per level exploits I/O concurrency via Promise.all.
  let currentLevel: Array<T> = [dir];
  while (currentLevel.length > 0) {
    const reads = await Promise.all(currentLevel.map(d =>
      readdir(d, readdirOpts).then(
        dirents => ({dir: d, dirents: dirents as unknown as Array<Dirent<T>>, err: undefined as unknown}),
        err => ({dir: d, dirents: undefined as unknown as Array<Dirent<T>>, err}),
      )
    ));
    const nextLevel: Array<T> = [];
    for (const {dir: d, dirents, err} of reads) {
      if (err) {
        if (strict) throw err;
        yield {path: d, err};
        continue;
      }
      const prefix = makeDirPrefix(d, encoding);
      for (const dirent of dirents) {
        const path = makePath<T>(dirent.name, prefix, encoding);

        let isIncluded = true;
        if (excludeMatcher || includeMatcher) {
          const sp = encoding === "buffer" ? toString(path as Buffer) : path as string;
          if (excludeMatcher?.(sp)) continue;
          if (includeMatcher) isIncluded = includeMatcher(sp);
        }

        const isDir = dirent.isDirectory();
        const isSym = dirent.isSymbolicLink();
        const isFollowedSym = followSymlinks && isSym;
        let stats: Stats | undefined;

        if (isFollowedSym || (isIncluded && needStats)) {
          try {
            stats = await statFn(path);
          } catch (err) {
            if (strict) throw err;
            if (isIncluded) yield {path, err: err as Error};
          }
        }

        if (isIncluded) yield build(path, isDir, isSym, stats, needStats);
        if (isFollowedSym ? stats?.isDirectory() : isDir) nextLevel.push(path);
      }
    }
    currentLevel = nextLevel;
  }
}

/** Recursively read a directory, returning all entries as an array. Memory usage is `O(n)`. */
export async function rrdirAsync<T extends Dir>(dir: T, opts: RRDirOpts = {}): Promise<Array<Entry<T>>> {
  const init = initOpts(dir, opts);
  const results: Array<Entry<T>> = [];
  await rrdirAsyncInner(init.dir, init.internalOpts, results);
  return results;
}

async function rrdirAsyncInner<T extends Dir>(dir: T, internalOpts: InternalOpts, results: Array<Entry<T>>): Promise<void> {
  const {includeMatcher, excludeMatcher, encoding, followSymlinks, needStats, strict, readdirOpts, statFn} = internalOpts;

  let dirents: Array<Dirent<T>> = [];
  try {
    dirents = await readdir(dir, readdirOpts) as unknown as Array<Dirent<T>>;
  } catch (err) {
    if (strict) throw err;
    results.push({path: dir, err: err as Error});
  }
  if (!dirents.length) return;

  const pendingDirs: Array<T> = [];
  const prefix = makeDirPrefix(dir, encoding);
  for (const dirent of dirents) {
    const path = makePath<T>(dirent.name, prefix, encoding);

    let isIncluded = true;
    if (excludeMatcher || includeMatcher) {
      const sp = encoding === "buffer" ? toString(path as Buffer) : path as string;
      if (excludeMatcher?.(sp)) continue;
      if (includeMatcher) isIncluded = includeMatcher(sp);
    }

    const isDir = dirent.isDirectory();
    const isSym = dirent.isSymbolicLink();
    const isFollowedSym = followSymlinks && isSym;
    let stats: Stats | undefined;

    if (isFollowedSym || (isIncluded && needStats)) {
      try {
        stats = await statFn(path);
      } catch (err) {
        if (strict) throw err;
        if (isIncluded) results.push({path, err: err as Error});
      }
    }

    if (isIncluded) results.push(build(path, isDir, isSym, stats, needStats));
    if (isFollowedSym ? stats?.isDirectory() : isDir) pendingDirs.push(path);
  }

  if (pendingDirs.length) {
    await Promise.all(pendingDirs.map(p => rrdirAsyncInner(p, internalOpts, results)));
  }
}

/** Synchronously recursively read a directory, returning all entries as an array. Memory usage is `O(n)`. */
export function rrdirSync<T extends Dir>(dir: T, opts: RRDirOpts = {}): Array<Entry<T>> {
  const init = initOpts(dir, opts);
  const results: Array<Entry<T>> = [];
  rrdirSyncInner(init.dir, init.internalOpts, results);
  return results;
}

function rrdirSyncInner<T extends Dir>(dir: T, internalOpts: InternalOpts, results: Array<Entry<T>>): void {
  const {includeMatcher, excludeMatcher, encoding, followSymlinks, needStats, strict, readdirOpts, statSyncFn} = internalOpts;
  const stack: Array<T> = [dir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    let dirents: Array<Dirent<T>> = [];
    try {
      dirents = readdirSync(currentDir, readdirOpts) as unknown as Array<Dirent<T>>;
    } catch (err) {
      if (strict) throw err;
      results.push({path: currentDir, err: err as Error});
      continue;
    }
    if (!dirents.length) continue;

    const prefix = makeDirPrefix(currentDir, encoding);
    for (const dirent of dirents) {
      const path = makePath<T>(dirent.name, prefix, encoding);

      let isIncluded = true;
      if (excludeMatcher || includeMatcher) {
        const sp = encoding === "buffer" ? toString(path as Buffer) : path as string;
        if (excludeMatcher?.(sp)) continue;
        if (includeMatcher) isIncluded = includeMatcher(sp);
      }

      const isDir = dirent.isDirectory();
      const isSym = dirent.isSymbolicLink();
      const isFollowedSym = followSymlinks && isSym;
      let stats: Stats | undefined;

      if (isFollowedSym || (isIncluded && needStats)) {
        try {
          stats = statSyncFn(path);
        } catch (err) {
          if (strict) throw err;
          if (isIncluded) results.push({path, err: err as Error});
        }
      }

      if (isIncluded) results.push(build(path, isDir, isSym, stats, needStats));
      if (isFollowedSym ? stats?.isDirectory() : isDir) stack.push(path);
    }
  }
}

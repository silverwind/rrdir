import {readdir, stat, lstat} from "node:fs/promises";
import {readdirSync, statSync, lstatSync} from "node:fs";
import {sep, resolve, isAbsolute} from "node:path";
import type {Stats, Dirent} from "node:fs";

const encoder = new TextEncoder();
const toUint8Array = encoder.encode.bind(encoder);
const decoder = new TextDecoder();
const toString = decoder.decode.bind(decoder);
const sepUint8Array = toUint8Array(sep);
const isWindows = sep === "\\";

export type Encoding = "utf8" | "buffer";
export type Dir = string | Buffer;

export type RRDirOpts = {
  strict?: boolean,
  stats?: boolean,
  followSymlinks?: boolean,
  include?: Array<string>,
  exclude?: Array<string>,
  insensitive?: boolean,
};

type Matcher = ((path: string) => boolean) | null;

type InternalOpts = {
  includeMatcher: Matcher,
  excludeMatcher: Matcher,
  hasMatcher: boolean,
  encoding: Encoding,
  followSymlinks: boolean,
  needStats: boolean,
  strict: boolean,
  readdirOpts: any,
};

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

const getEncoding = (dir: Dir): Encoding => dir instanceof Uint8Array ? "buffer" : "utf8";

const defaultOpts: RRDirOpts = {
  strict: false,
  stats: false,
  followSymlinks: false,
  exclude: undefined,
  include: undefined,
  insensitive: false,
};

function makePath<T extends Dir>({name}: Dirent<T>, dir: T, encoding: Encoding): T {
  if (encoding === "buffer") {
    if (dir === ".") return name;
    const dirBuf = dir as unknown as Uint8Array;
    const nameBuf = name as unknown as Uint8Array;
    const result = new Uint8Array(dirBuf.length + sepUint8Array.length + nameBuf.length);
    result.set(dirBuf, 0);
    result.set(sepUint8Array, dirBuf.length);
    result.set(nameBuf, dirBuf.length + sepUint8Array.length);
    return result as T;
  } else {
    return dir === "." ? name : `${dir as string}${sep}${name}` as T;
  }
}

function build<T extends Dir>(path: T, isDir: boolean, isSym: boolean, stats: Stats | undefined, needStats: boolean): Entry<T> {
  const entry: Entry<T> = {
    path,
    directory: stats ? stats.isDirectory() : isDir,
    symlink: stats ? stats.isSymbolicLink() : isSym,
  };
  if (needStats) entry.stats = stats;
  return entry;
}

// Convert a glob pattern to a regular expression
function globToRegex(pattern: string, insensitive: boolean): RegExp {
  // Normalize pattern to use forward slashes for simpler matching
  pattern = pattern.replace(/\\/g, "/");

  // Special handling for patterns ending with /** to also match the directory itself
  const endsWithDoubleStar = pattern.endsWith("/**");

  // Escape special regex characters except * and /
  let regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    // Replace ** with placeholder
    .replace(/\*\*/g, "__DOUBLESTAR__")
    // Replace * to match anything except /
    .replace(/\*/g, "[^/]*")
    // Restore ** to match anything including /
    .replace(/__DOUBLESTAR__/g, ".*");

  if (endsWithDoubleStar) {
    // Remove trailing /.*
    regex = regex.slice(0, -3);
    // Make trailing / and anything after it optional
    regex = `^${regex}(?:/.*)?$`;
  } else {
    regex = `^${regex}$`;
  }

  return new RegExp(regex, insensitive ? "i" : "");
}

// Create a matcher function from an array of glob patterns
function createMatcher(patterns: Array<string> | undefined, insensitive: boolean): Matcher {
  if (!patterns?.length) return null;

  const regexes = patterns.map(pattern => globToRegex(pattern, insensitive));
  const cwdPrefix = resolve(".") + sep;

  return (path: string) => {
    // Normalize path to absolute using string concatenation instead of resolve()
    const absolute = isAbsolute(path) ? path : cwdPrefix + path;
    const normalizedPath = isWindows ? absolute.replace(/\\/g, "/") : absolute;
    return regexes.some(regex => regex.test(normalizedPath));
  };
}

function makeMatchers({include, exclude, insensitive}: RRDirOpts) {
  return {
    includeMatcher: createMatcher(include || [], insensitive || false),
    excludeMatcher: createMatcher(exclude || [], insensitive || false),
  } as {
    includeMatcher: Matcher,
    excludeMatcher: Matcher,
  };
}

function initOpts<T extends Dir>(dir: T, opts: RRDirOpts): {dir: T, opts: RRDirOpts, internalOpts: InternalOpts} {
  opts = {...defaultOpts, ...opts};
  const {includeMatcher, excludeMatcher} = makeMatchers(opts);
  if (typeof dir === "string" && /[/\\]$/.test(dir)) {
    dir = dir.substring(0, dir.length - 1) as T;
  }
  const encoding = getEncoding(dir);
  return {dir, opts, internalOpts: {
    includeMatcher,
    excludeMatcher,
    hasMatcher: Boolean(excludeMatcher || includeMatcher),
    encoding,
    followSymlinks: Boolean(opts.followSymlinks),
    needStats: Boolean(opts.stats),
    strict: Boolean(opts.strict),
    readdirOpts: {encoding, withFileTypes: true},
  }};
}

function getStringPath(path: Dir, encoding: Encoding): string {
  return encoding === "buffer" ? toString(path as Buffer) : path as string;
}

export async function* rrdir<T extends Dir>(dir: T, opts: RRDirOpts = {}): AsyncGenerator<Entry<T>> {
  const init = initOpts(dir, opts);
  const {hasMatcher, encoding, followSymlinks, needStats, strict, readdirOpts} = init.internalOpts;
  dir = init.dir;

  // Fast path: stack-based iteration avoids recursive yield* overhead.
  // Each yield crosses 1 generator boundary instead of O(depth).
  if (!hasMatcher && !followSymlinks && !needStats) {
    const stack: Array<T> = [dir];
    while (stack.length > 0) {
      const currentDir = stack.pop() as T;
      let dirents: Array<Dirent<T>>;
      try {
        dirents = await readdir(currentDir, readdirOpts) as unknown as Array<Dirent<T>>;
      } catch (err) {
        if (strict) throw err;
        yield {path: currentDir, err};
        continue;
      }
      for (const dirent of dirents) {
        const path = makePath(dirent, currentDir, encoding);
        const isDir = dirent.isDirectory();
        yield {path, directory: isDir, symlink: dirent.isSymbolicLink()};
        if (isDir) stack.push(path);
      }
    }
    return;
  }

  // Slow path: recursive yield* with full feature support
  yield* rrdirInner(dir, init.opts, init.internalOpts);
}

async function* rrdirInner<T extends Dir>(dir: T, opts: RRDirOpts, internalOpts: InternalOpts): AsyncGenerator<Entry<T>> {
  const {includeMatcher, excludeMatcher, hasMatcher, encoding, followSymlinks, needStats, strict, readdirOpts} = internalOpts;

  let dirents: Array<Dirent<T>> = [];
  try {
    dirents = await readdir(dir, readdirOpts) as unknown as Array<Dirent<T>>;
  } catch (err) {
    if (strict) throw err;
    yield {path: dir, err};
  }
  if (!dirents.length) return;

  for (const dirent of dirents) {
    const path = makePath<T>(dirent, dir, encoding);

    let isIncluded = true;
    if (hasMatcher) {
      const stringPath = getStringPath(path, encoding);
      if (excludeMatcher?.(stringPath)) continue;
      isIncluded = !includeMatcher || includeMatcher(stringPath);
    }

    const isDir = dirent.isDirectory();
    const isSym = dirent.isSymbolicLink();
    const isFollowedSym = followSymlinks && isSym;
    let stats: Stats | undefined;

    if (isIncluded) {
      if (needStats || isFollowedSym) {
        try {
          stats = await (followSymlinks ? stat : lstat)(path);
        } catch (err) {
          if (strict) throw err;
          yield {path, err};
        }
      }

      yield build(path, isDir, isSym, stats, needStats);
    }

    let recurse = isDir;
    if (isFollowedSym) {
      if (!stats) try { stats = await stat(path); } catch {}
      recurse = Boolean(stats?.isDirectory());
    }

    if (recurse) yield* rrdirInner(path, opts, internalOpts);
  }
}

export async function rrdirAsync<T extends Dir>(dir: T, opts: RRDirOpts = {}): Promise<Array<Entry<T>>> {
  const init = initOpts(dir, opts);
  const results: Array<Entry<T>> = [];
  await rrdirAsyncInner(init.dir, init.opts, init.internalOpts, results);
  return results;
}

async function rrdirAsyncInner<T extends Dir>(dir: T, opts: RRDirOpts, internalOpts: InternalOpts, results: Array<Entry<T>>): Promise<void> {
  const {includeMatcher, excludeMatcher, hasMatcher, encoding, followSymlinks, needStats, strict, readdirOpts} = internalOpts;

  let dirents: Array<Dirent<T>> = [];
  try {
    dirents = await readdir(dir, readdirOpts) as unknown as Array<Dirent<T>>;
  } catch (err) {
    if (strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return;

  const pendingDirs: Array<T> = [];
  for (const dirent of dirents) {
    const path = makePath(dirent, dir, encoding);

    let isIncluded = true;
    if (hasMatcher) {
      const stringPath = getStringPath(path, encoding);
      if (excludeMatcher?.(stringPath)) continue;
      isIncluded = !includeMatcher || includeMatcher(stringPath);
    }

    const isDir = dirent.isDirectory();
    const isSym = dirent.isSymbolicLink();
    const isFollowedSym = followSymlinks && isSym;
    let stats: Stats | undefined;

    if (isIncluded) {
      if (needStats || isFollowedSym) {
        try {
          stats = await (followSymlinks ? stat : lstat)(path);
        } catch (err) {
          if (strict) throw err;
          results.push({path, err});
        }
      }

      results.push(build(path, isDir, isSym, stats, needStats));
    }

    let recurse = isDir;
    if (isFollowedSym) {
      if (!stats) try { stats = await stat(path); } catch {}
      recurse = Boolean(stats?.isDirectory());
    }

    if (recurse) pendingDirs.push(path);
  }

  if (pendingDirs.length) {
    await Promise.all(pendingDirs.map(p => rrdirAsyncInner(p, opts, internalOpts, results)));
  }
}

export function rrdirSync<T extends Dir>(dir: T, opts: RRDirOpts = {}): Array<Entry<T>> {
  const init = initOpts(dir, opts);
  const results: Array<Entry<T>> = [];
  rrdirSyncInner(init.dir, init.opts, init.internalOpts, results);
  return results;
}

function rrdirSyncInner<T extends Dir>(dir: T, opts: RRDirOpts, internalOpts: InternalOpts, results: Array<Entry<T>>): void {
  const {includeMatcher, excludeMatcher, hasMatcher, encoding, followSymlinks, needStats, strict, readdirOpts} = internalOpts;

  let dirents: Array<Dirent<T>> = [];
  try {
    dirents = readdirSync(dir, readdirOpts) as unknown as Array<Dirent<T>>;
  } catch (err) {
    if (strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir, encoding);

    let isIncluded = true;
    if (hasMatcher) {
      const stringPath = getStringPath(path, encoding);
      if (excludeMatcher?.(stringPath)) continue;
      isIncluded = !includeMatcher || includeMatcher(stringPath);
    }

    const isDir = dirent.isDirectory();
    const isSym = dirent.isSymbolicLink();
    const isFollowedSym = followSymlinks && isSym;
    let stats: Stats | undefined;

    if (isIncluded) {
      if (needStats || isFollowedSym) {
        try {
          stats = (followSymlinks ? statSync : lstatSync)(path);
        } catch (err) {
          if (strict) throw err;
          results.push({path, err});
        }
      }
      results.push(build(path, isDir, isSym, stats, needStats));
    }

    let recurse = isDir;
    if (isFollowedSym) {
      if (!stats) try { stats = statSync(path); } catch {}
      recurse = Boolean(stats?.isDirectory());
    }

    if (recurse) rrdirSyncInner(path, opts, internalOpts, results);
  }
}

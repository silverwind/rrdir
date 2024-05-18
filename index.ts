import {readdir, stat, lstat} from "node:fs/promises";
import {readdirSync, statSync, lstatSync} from "node:fs";
import {sep, resolve} from "node:path";
import picomatch from "picomatch";
import type {Stats, Dirent} from "node:fs";
import type {Matcher} from "picomatch";

const encoder = new TextEncoder();
const toUint8Array = encoder.encode.bind(encoder);
const decoder = new TextDecoder();
const toString = decoder.decode.bind(decoder);
const sepUint8Array = toUint8Array(sep);

type Encoding = "utf8" | "buffer";
type Dir = string | Uint8Array;
type DirNodeCompatible = string | Buffer;

type RRDirOpts = {
  strict?: boolean,
  stats?: boolean,
  followSymlinks?: boolean,
  include?: string[],
  exclude?: string[],
  insensitive?: boolean,
}

type InternalOpts = {
  includeMatcher?: Matcher,
  excludeMatcher?: Matcher,
  encoding?: Encoding,
}

type Entry = {
  /** The path to the entry, will be relative if `dir` is given relative. If `dir` is a `Uint8Array`, this will be too. Always present. */
  path: Dir,
  /** Boolean indicating whether the entry is a directory. `undefined` on error. */
  directory?: boolean,
  /** Boolean indicating whether the entry is a symbolic link. `undefined` on error. */
  symlink?: boolean,
  /** A [`fs.stats`](https://nodejs.org/api/fs.html#fs_class_fs_stats) object, present when `options.stats` is set. `undefined` on error. */
  stats?: Stats,
  /** Any error encountered while reading this entry. `undefined` on success. */
  err?: Error,
}

const getEncoding = (dir: Dir) => dir instanceof Uint8Array ? "buffer" : "utf8";

const defaultOpts: RRDirOpts = {
  strict: false,
  stats: false,
  followSymlinks: false,
  exclude: undefined,
  include: undefined,
  insensitive: false,
};

function makePath({name}: Dirent, dir: Dir, encoding: Encoding) {
  if (encoding === "buffer") {
    return dir === "." ? name : Uint8Array.from([...dir, ...sepUint8Array, ...name]);
  } else {
    return dir === "." ? name : `${dir as string}${sep}${name}`;
  }
}

function build(dirent: Dirent, path: Dir, stats: Stats, opts: RRDirOpts) {
  return {
    path,
    directory: (stats || dirent).isDirectory(),
    symlink: (stats || dirent).isSymbolicLink(),
    ...(opts.stats ? {stats} : {}),
  };
}

function makeMatchers({include, exclude, insensitive}: RRDirOpts) {
  const opts = {
    dot: true,
    flags: insensitive ? "i" : undefined,
  };

  // resolve the path to an absolute one because picomatch can not deal properly
  // with relative paths that start with ./ or .\
  // https://github.com/micromatch/picomatch/issues/121
  return {
    includeMatcher: include?.length ? (path: string) => picomatch(include, opts)(resolve(path)) : null,
    excludeMatcher: exclude?.length ? (path: string) => picomatch(exclude, opts)(resolve(path)) : null,
  };
}

export async function* rrdir(dir: Dir, opts: RRDirOpts = {}, {includeMatcher, excludeMatcher, encoding}: InternalOpts = {}): AsyncGenerator<Entry> {
  if (includeMatcher === undefined) {
    opts = {...defaultOpts, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (typeof dir === "string" && /[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
    encoding = getEncoding(dir);
  }

  let dirents: Dirent[] = [];
  try {
    // @ts-ignore -- bug in @types/node
    dirents = await readdir(dir as DirNodeCompatible, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    yield {path: dir, err};
  }
  if (!dirents.length) return;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? toString(path) : path)) continue;

    const isSymbolicLink: boolean = opts.followSymlinks && dirent.isSymbolicLink();
    const encodedPath: string = encoding === "buffer" ? toString(path) : path;
    const isIncluded: boolean = !includeMatcher || includeMatcher(encodedPath);
    let stats: Stats;

    if (isIncluded) {
      if (opts.stats || isSymbolicLink) {
        try {
          stats = await (opts.followSymlinks ? stat : lstat)(path as DirNodeCompatible);
        } catch (err) {
          if (opts.strict) throw err;
          yield {path, err};
        }
      }

      yield build(dirent, path, stats, opts);
    }

    let recurse = false;
    if (isSymbolicLink) {
      if (!stats) try { stats = await stat(path as DirNodeCompatible); } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) yield* rrdir(path, opts, {includeMatcher, excludeMatcher, encoding});
  }
}

export async function rrdirAsync(dir: Dir, opts: RRDirOpts = {}, {includeMatcher, excludeMatcher, encoding}: InternalOpts = {}): Promise<Entry[]> {
  if (includeMatcher === undefined) {
    opts = {...defaultOpts, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (typeof dir === "string" && /[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
    encoding = getEncoding(dir);
  }

  const results: Entry[] = [];
  let dirents: Dirent[] = [];
  try {
    // @ts-ignore -- bug in @types/node
    dirents = await readdir(dir, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return results;

  await Promise.all(dirents.map(async dirent => {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? toString(path) : path)) return;

    const isSymbolicLink: boolean = opts.followSymlinks && dirent.isSymbolicLink();
    const encodedPath: string = encoding === "buffer" ? toString(path) : path;
    const isIncluded: boolean = !includeMatcher || includeMatcher(encodedPath);
    let stats: Stats;

    if (isIncluded) {
      if (opts.stats || isSymbolicLink) {
        try {
          stats = await (opts.followSymlinks ? stat : lstat)(path as DirNodeCompatible);
        } catch (err) {
          if (opts.strict) throw err;
          results.push({path, err});
        }
      }

      results.push(build(dirent, path, stats, opts));
    }

    let recurse = false;
    if (isSymbolicLink) {
      if (!stats) try { stats = await stat(path as DirNodeCompatible); } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) results.push(...await rrdirAsync(path, opts, {includeMatcher, excludeMatcher, encoding}));
  }));

  return results;
}

export function rrdirSync(dir: Dir, opts: RRDirOpts = {}, {includeMatcher, excludeMatcher, encoding}: InternalOpts = {}): Entry[] {
  if (includeMatcher === undefined) {
    opts = {...defaultOpts, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (typeof dir === "string" && /[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
    encoding = getEncoding(dir);
  }

  const results: Entry[] = [];
  let dirents: Dirent[] = [];
  try {
    // @ts-ignore -- bug in @types/node
    dirents = readdirSync(dir as DirNodeCompatible, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return results;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? toString(path) : path)) continue;

    const isSymbolicLink: boolean = opts.followSymlinks && dirent.isSymbolicLink();
    const encodedPath: string = encoding === "buffer" ? toString(path) : path;
    const isIncluded: boolean = !includeMatcher || includeMatcher(encodedPath);
    let stats: Stats;

    if (isIncluded) {
      if (opts.stats || isSymbolicLink) {
        try {
          stats = (opts.followSymlinks ? statSync : lstatSync)(path as DirNodeCompatible);
        } catch (err) {
          if (opts.strict) throw err;
          results.push({path, err});
        }
      }
      results.push(build(dirent, path, stats, opts));
    }

    let recurse = false;
    if (isSymbolicLink) {
      if (!stats) try { stats = statSync(path as DirNodeCompatible); } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) results.push(...rrdirSync(path, opts, {includeMatcher, excludeMatcher, encoding}));
  }

  return results;
}

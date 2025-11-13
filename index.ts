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

export type Encoding = "utf8" | "buffer";
export type Dir = string | Buffer;

export type RRDirOpts = {
  strict?: boolean,
  stats?: boolean,
  followSymlinks?: boolean,
  include?: string[],
  exclude?: string[],
  insensitive?: boolean,
};

type InternalOpts = {
  includeMatcher?: Matcher,
  excludeMatcher?: Matcher,
  encoding?: Encoding,
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

const getEncoding = (dir: Dir) => dir instanceof Uint8Array ? "buffer" : "utf8";

const defaultOpts: RRDirOpts = {
  strict: false,
  stats: false,
  followSymlinks: false,
  exclude: undefined,
  include: undefined,
  insensitive: false,
};

function makePath<T extends Dir>({name}: Dirent<T>, dir: T, encoding: Encoding | undefined): T {
  if (encoding === "buffer") {
    return dir === "." ? name : Uint8Array.from([...dir, ...sepUint8Array, ...name]) as T;
  } else {
    return dir === "." ? name : `${dir as string}${sep}${name}` as T;
  }
}

function build<T extends Dir>(dirent: Dirent<T>, path: T, stats: Stats | undefined, opts: RRDirOpts) {
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
  } as {
    includeMatcher: Matcher,
    excludeMatcher: Matcher,
  };
}

export async function* rrdir<T extends Dir>(dir: T, opts: RRDirOpts = {}, {includeMatcher, excludeMatcher, encoding}: InternalOpts = {}): AsyncGenerator<Entry<T>> {
  if (includeMatcher === undefined) {
    opts = {...defaultOpts, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (typeof dir === "string" && /[/\\]$/.test(dir)) {
      dir = dir.substring(0, dir.length - 1) as T;
    }
    encoding = getEncoding(dir);
  }

  let dirents: Dirent<T>[] = [];
  try {
    // @ts-expect-error -- bug in @types/node
    dirents = await readdir(dir, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    yield {path: dir, err};
  }
  if (!dirents.length) return;

  for (const dirent of dirents) {
    const path = makePath<T>(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? toString(path as Buffer) : (path as string))) continue;

    const isSymbolicLink = Boolean(opts.followSymlinks && dirent.isSymbolicLink());
    const encodedPath: string = encoding === "buffer" ? toString(path as Buffer) : path as string;
    const isIncluded: boolean = !includeMatcher || includeMatcher(encodedPath);
    let stats: Stats | undefined;

    if (isIncluded) {
      if (opts.stats || isSymbolicLink) {
        try {
          stats = await (opts.followSymlinks ? stat : lstat)(path);
        } catch (err) {
          if (opts.strict) throw err;
          yield {path, err};
        }
      }

      yield build(dirent, path, stats, opts);
    }

    let recurse = false;
    if (isSymbolicLink) {
      if (!stats) try { stats = await stat(path); } catch {}
      if (stats?.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) yield* rrdir(path, opts, {includeMatcher, excludeMatcher, encoding});
  }
}

export async function rrdirAsync<T extends Dir>(dir: T, opts: RRDirOpts = {}, {includeMatcher, excludeMatcher, encoding}: InternalOpts = {}): Promise<Array<Entry<T>>> {
  if (includeMatcher === undefined) {
    opts = {...defaultOpts, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (typeof dir === "string" && /[/\\]$/.test(dir)) {
      dir = dir.substring(0, dir.length - 1) as T;
    }
    encoding = getEncoding(dir);
  }

  const results: Array<Entry<T>> = [];
  let dirents: Array<Dirent<T>> = [];
  try {
    // @ts-expect-error -- bug in @types/node
    dirents = await readdir(dir, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return results;

  await Promise.all(dirents.map(async dirent => {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? toString(path as Buffer) : path as string)) return;

    const isSymbolicLink = Boolean(opts.followSymlinks && dirent.isSymbolicLink());
    const encodedPath: string = encoding === "buffer" ? toString(path as Buffer) : path as string;
    const isIncluded: boolean = !includeMatcher || includeMatcher(encodedPath);
    let stats: Stats | undefined;

    if (isIncluded) {
      if (opts.stats || isSymbolicLink) {
        try {
          stats = await (opts.followSymlinks ? stat : lstat)(path);
        } catch (err) {
          if (opts.strict) throw err;
          results.push({path, err});
        }
      }

      results.push(build(dirent, path, stats, opts));
    }

    let recurse = false;
    if (isSymbolicLink) {
      if (!stats) try { stats = await stat(path); } catch {}
      if (stats?.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) results.push(...await rrdirAsync(path, opts, {includeMatcher, excludeMatcher, encoding}));
  }));

  return results;
}

export function rrdirSync<T extends Dir>(dir: T, opts: RRDirOpts = {}, {includeMatcher, excludeMatcher, encoding}: InternalOpts = {}): Array<Entry<T>> {
  if (includeMatcher === undefined) {
    opts = {...defaultOpts, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (typeof dir === "string" && /[/\\]$/.test(dir)) {
      dir = dir.substring(0, dir.length - 1) as T;
    }
    encoding = getEncoding(dir);
  }

  const results: Array<Entry<T>> = [];
  let dirents: Array<Dirent<T>> = [];
  try {
    // @ts-expect-error -- bug in @types/node
    dirents = readdirSync(dir, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return results;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? toString(path as Buffer) : path as string)) continue;

    const isSymbolicLink = Boolean(opts.followSymlinks && dirent.isSymbolicLink());
    const encodedPath: string = encoding === "buffer" ? toString(path as Buffer) : path as string;
    const isIncluded: boolean = !includeMatcher || includeMatcher(encodedPath);
    let stats: Stats | undefined;

    if (isIncluded) {
      if (opts.stats || isSymbolicLink) {
        try {
          stats = (opts.followSymlinks ? statSync : lstatSync)(path);
        } catch (err) {
          if (opts.strict) throw err;
          results.push({path, err});
        }
      }
      results.push(build(dirent, path, stats, opts));
    }

    let recurse = false;
    if (isSymbolicLink) {
      if (!stats) try { stats = statSync(path); } catch {}
      if (stats?.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) results.push(...rrdirSync(path, opts, {includeMatcher, excludeMatcher, encoding}));
  }

  return results;
}

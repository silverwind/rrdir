import {readdir, stat, lstat} from "node:fs/promises";
import {readdirSync, statSync, lstatSync} from "node:fs";
import {sep} from "node:path";
import picomatch from "picomatch";

const sepBuffer = Buffer.from(sep);

const defaults = {
  strict: false,
  stats: false,
  followSymlinks: false,
  exclude: undefined,
  include: undefined,
  insensitive: false,
};

function makePath(entry, dir, encoding) {
  if (encoding === "buffer") {
    return dir === "." ? entry.name : Buffer.from([...dir, ...sepBuffer, ...entry.name]);
  } else {
    return dir === "." ? entry.name : `${dir}${sep}${entry.name}`;
  }
}

function build(dirent, path, stats, opts) {
  return {
    path,
    directory: (stats || dirent).isDirectory(),
    symlink: (stats || dirent).isSymbolicLink(),
    ...(opts.stats ? {stats} : {}),
  };
}

function makeMatchers({include, exclude, insensitive}) {
  const opts = {
    dot: true,
    flags: insensitive ? "i" : undefined,
  };
  return {
    includeMatcher: include ? picomatch(include, opts) : null,
    excludeMatcher: exclude ? picomatch(exclude, opts) : null,
  };
}

export async function* rrdir(dir, opts = {}, {includeMatcher, excludeMatcher, encoding} = {}) {
  if (includeMatcher === undefined) {
    opts = {...defaults, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (/[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
    encoding = Buffer.isBuffer(dir) ? "buffer" : undefined;
  }

  let dirents = [];
  try {
    dirents = await readdir(dir, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    yield {path: dir, err};
  }
  if (!dirents.length) return;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? String(path) : path)) continue;

    const isSymbolicLink = opts.followSymlinks && dirent.isSymbolicLink();
    const encodedPath = encoding === "buffer" ? String(path) : path;
    const isIncluded = !includeMatcher || includeMatcher(encodedPath);
    let stats;

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
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) yield* await rrdir(path, opts, {includeMatcher, excludeMatcher, encoding});
  }
}

export async function rrdirAsync(dir, opts = {}, {includeMatcher, excludeMatcher, encoding} = {}) {
  if (includeMatcher === undefined) {
    opts = {...defaults, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (/[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
    encoding = Buffer.isBuffer(dir) ? "buffer" : undefined;
  }

  const results = [];
  let dirents = [];
  try {
    dirents = await readdir(dir, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return results;

  await Promise.all(dirents.map(async dirent => {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? String(path) : path)) return;

    const isSymbolicLink = opts.followSymlinks && dirent.isSymbolicLink();
    const encodedPath = encoding === "buffer" ? String(path) : path;
    const isIncluded = !includeMatcher || includeMatcher(encodedPath);
    let stats;

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
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) results.push(...await rrdirAsync(path, opts, {includeMatcher, excludeMatcher, encoding}));
  }));

  return results;
}

export function rrdirSync(dir, opts = {}, {includeMatcher, excludeMatcher, encoding} = {}) {
  if (includeMatcher === undefined) {
    opts = {...defaults, ...opts};
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (/[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
    encoding = Buffer.isBuffer(dir) ? "buffer" : undefined;
  }

  const results = [];
  let dirents = [];
  try {
    dirents = readdirSync(dir, {encoding, withFileTypes: true});
  } catch (err) {
    if (opts.strict) throw err;
    results.push({path: dir, err});
  }
  if (!dirents.length) return results;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir, encoding);
    if (excludeMatcher?.(encoding === "buffer" ? String(path) : path)) continue;

    const isSymbolicLink = opts.followSymlinks && dirent.isSymbolicLink();
    const encodedPath = encoding === "buffer" ? String(path) : path;
    const isIncluded = !includeMatcher || includeMatcher(encodedPath);
    let stats;

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
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (recurse) results.push(...rrdirSync(path, opts, {includeMatcher, excludeMatcher, encoding}));
  }

  return results;
}

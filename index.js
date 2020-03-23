"use strict";

const {readdir, stat, lstat} = require("fs").promises;
const {readdirSync, statSync, lstatSync} = require("fs");
const {sep} = require("path");
const picomatch = require("picomatch");

const defaults = {
  strict: false,
  stats: false,
  followSymlinks: false,
  exclude: undefined,
  include: undefined,
  match: {
    dot: true,
  },
};

const readDirOpts = {
  withFileTypes: true,
};

function makePath(entry, dir) {
  return dir === "." ? entry.name : `${dir}${sep}${entry.name}`;
}

function build(dirent, path, stats, opts) {
  const entry = {
    path,
    directory: stats ? stats.isDirectory() : dirent.isDirectory(),
    symlink: stats ? stats.isSymbolicLink() : dirent.isSymbolicLink(),
  };
  if (opts.stats) entry.stats = stats;
  return entry;
}

function makeMatchers({include, exclude, match}) {
  return {
    includeMatcher: include ? picomatch(include, match) : () => true,
    excludeMatcher: exclude ? picomatch(exclude, match) : () => false,
  };
}

const rrdir = module.exports = async (dir, opts = {}, {includeMatcher, excludeMatcher} = {}) => {
  if (includeMatcher === undefined) {
    opts = Object.assign({}, defaults, opts);
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (/[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
  }

  const results = [];
  let dirents = [];

  try {
    dirents = await readdir(dir, readDirOpts);
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      results.push({path: dir, err});
    }
  }
  if (!dirents.length) return results;

  await Promise.all(dirents.map(async dirent => {
    const path = makePath(dirent, dir);
    if (excludeMatcher(path)) return;

    let stats;
    if (opts.stats) {
      try {
        stats = await (opts.followSymlinks ? stat : lstat)(path);
      } catch (err) {
        if (opts.strict) throw err;
        results.push({path, err});
      }
    }

    let recurse = false;
    if (opts.followSymlinks && dirent.isSymbolicLink()) {
      if (!stats) try { stats = await stat(path) } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (includeMatcher(path)) results.push(build(dirent, path, stats, opts));
    if (recurse) results.push(...await rrdir(path, opts, {includeMatcher, excludeMatcher}));
  }));

  return results;
};

rrdir.sync = module.exports.sync = (dir, opts = {}, {includeMatcher, excludeMatcher} = {}) => {
  if (includeMatcher === undefined) {
    opts = Object.assign({}, defaults, opts);
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (/[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
  }

  const results = [];
  let dirents = [];

  try {
    dirents = readdirSync(dir, readDirOpts);
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      results.push({path: dir, err});
    }
  }
  if (!dirents.length) return results;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir);
    if (excludeMatcher(path)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = (opts.followSymlinks ? statSync : lstatSync)(path);
      } catch (err) {
        if (opts.strict) throw err;
        results.push({path, err});
      }
    }

    let recurse = false;
    if (opts.followSymlinks && dirent.isSymbolicLink()) {
      if (!stats) try { stats = statSync(path) } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (includeMatcher(path)) results.push(build(dirent, path, stats, opts));
    if (recurse) results.push(...rrdir.sync(path, opts, {includeMatcher, excludeMatcher}));
  }

  return results;
};

rrdir.stream = module.exports.stream = async function* (dir, opts = {}, {includeMatcher, excludeMatcher} = {}) {
  if (includeMatcher === undefined) {
    opts = Object.assign({}, defaults, opts);
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
    if (/[/\\]$/.test(dir)) dir = dir.substring(0, dir.length - 1);
  }

  let dirents = [];

  try {
    dirents = await readdir(dir, readDirOpts);
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      yield {path: dir, err};
    }
  }
  if (!dirents.length) return;

  for (const dirent of dirents) {
    const path = makePath(dirent, dir);
    if (excludeMatcher && excludeMatcher(path)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = await (opts.followSymlinks ? stat : lstat)(path);
      } catch (err) {
        if (opts.strict) throw err;
        yield {path, err};
      }
    }

    let recurse = false;
    if (opts.followSymlinks && dirent.isSymbolicLink()) {
      if (!stats) try { stats = await stat(path) } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (dirent.isDirectory()) {
      recurse = true;
    }

    if (includeMatcher(path)) yield build(dirent, path, stats, opts);
    if (recurse) yield* await rrdir.stream(path, opts, {includeMatcher, excludeMatcher});
  }
};

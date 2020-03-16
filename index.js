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
  // console.log(path, stats.isSymbolicLink(), dirent.isSymbolicLink());
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
  let entries = [];

  try {
    entries = await readdir(dir, readDirOpts);
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      results.push({path: dir, err});
    }
  }
  if (!entries.length) return results;

  await Promise.all(entries.map(async entry => {
    const path = makePath(entry, dir);
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
    if (opts.followSymlinks && entry.isSymbolicLink()) {
      if (!stats) try { stats = await stat(path) } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (entry.isDirectory()) {
      recurse = true;
    }

    if (includeMatcher(path)) results.push(build(entry, path, stats, opts));
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
  let entries = [];

  try {
    entries = readdirSync(dir, readDirOpts);
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      results.push({path: dir, err});
    }
  }
  if (!entries.length) return results;

  for (const entry of entries) {
    const path = makePath(entry, dir);
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
    if (opts.followSymlinks && entry.isSymbolicLink()) {
      if (!stats) try { stats = statSync(path) } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (entry.isDirectory()) {
      recurse = true;
    }

    if (includeMatcher(path)) results.push(build(entry, path, stats, opts));
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

  let entries = [];

  try {
    entries = await readdir(dir, readDirOpts);
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      yield {path: dir, err};
    }
  }
  if (!entries.length) return;

  for (const entry of entries) {
    const path = makePath(entry, dir);
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
    if (opts.followSymlinks && entry.isSymbolicLink()) {
      if (!stats) try { stats = await stat(path) } catch {}
      if (stats && stats.isDirectory()) recurse = true;
    } else if (entry.isDirectory()) {
      recurse = true;
    }

    if (includeMatcher(path)) yield build(entry, path, stats, opts);
    if (recurse) yield* await rrdir.stream(path, opts, {includeMatcher, excludeMatcher});
  }
};

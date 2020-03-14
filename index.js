"use strict";

const {readdir, stat, lstat} = require("fs").promises;
const {readdirSync, statSync, lstatSync} = require("fs");
const {join} = require("path");
const picomatch = require("picomatch");

const defaults = {
  strict: false,
  stats: false,
  followSymlinks: true,
  exclude: [],
  include: ["**"],
  match: {
    dot: true,
  },
};

const readDirOpts = {
  withFileTypes: true,
};

function build(dirent, path, stats) {
  const entry = {path, directory: dirent.isDirectory(), symlink: dirent.isSymbolicLink()};
  if (stats) entry.stats = stats;
  return entry;
}

function makeMatchers({include, exclude, match}) {
  return {
    includeMatcher: picomatch(include, match),
    excludeMatcher: picomatch(exclude),
  };
}

const rrdir = module.exports = async (dir, opts = {}, {includeMatcher, excludeMatcher} = {}) => {
  if (includeMatcher === undefined) {
    opts = Object.assign({}, defaults, opts);
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
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

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (excludeMatcher(path)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = await (opts.followSymlinks ? stat(path) : lstat(path));
      } catch (err) {
        if (opts.strict) throw err;
        results.push({path, err});
      }
    }

    if (includeMatcher(path)) results.push(build(entry, path, stats));
    if (entry.isDirectory()) results.push(...await rrdir(path, opts, {includeMatcher, excludeMatcher}));
  }

  return results;
};

rrdir.sync = module.exports.sync = (dir, opts = {}, {includeMatcher, excludeMatcher} = {}) => {
  if (includeMatcher === undefined) {
    opts = Object.assign({}, defaults, opts);
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
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
    const path = join(dir, entry.name);
    if (excludeMatcher(path)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = opts.followSymlinks ? statSync(path) : lstatSync(path);
      } catch (err) {
        if (opts.strict) throw err;
        results.push({path, err});
      }
    }

    if (includeMatcher(path)) results.push(build(entry, path, stats));
    if (entry.isDirectory()) results.push(...rrdir.sync(path, opts, {includeMatcher, excludeMatcher}));
  }

  return results;
};

rrdir.stream = module.exports.stream = async function* (dir, opts = {}, {includeMatcher, excludeMatcher} = {}) {
  if (includeMatcher === undefined) {
    opts = Object.assign({}, defaults, opts);
    ({includeMatcher, excludeMatcher} = makeMatchers(opts));
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
    const path = join(dir, entry.name);
    if (excludeMatcher && excludeMatcher(path)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = await (opts.followSymlinks ? stat(path) : lstat(path));
      } catch (err) {
        if (opts.strict) throw err;
        yield {path, err};
      }
    }

    if (includeMatcher(path)) yield build(entry, path, stats);
    if (entry.isDirectory()) yield* await rrdir.stream(path, opts, {includeMatcher, excludeMatcher});
  }
};

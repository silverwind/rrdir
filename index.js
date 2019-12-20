"use strict";

const {readdir, stat, lstat} = require("fs").promises;
const {readdirSync, statSync, lstatSync} = require("fs");
const {join, basename} = require("path");
const picomatch = require("picomatch");

const defaults = {
  encoding: "utf8",
  strict: false,
  stats: false,
  followSymlinks: true,
  exclude: [],
  include: [],
  match: {
    dot: true,
  }
};

function isExcluded(path, matcher) {
  if (!matcher) return false;
  return matcher(basename(path));
}

function isIncluded(entry, matcher) {
  if (!matcher || entry.isDirectory()) return true;
  return matcher(entry.name);
}

// when a include pattern is specified, stop yielding directories
function canInclude(entry, opts) {
  if (!opts.include || !opts.include.length) return true;
  return !entry.isDirectory();
}

function build(dirent, path, stats) {
  const entry = {path, directory: dirent.isDirectory(), symlink: dirent.isSymbolicLink()};
  if (stats) entry.stats = stats;
  return entry;
}

function makeMatchers(opts) {
  let includeMatcher = null;
  let excludeMatcher = null;

  if (opts && opts.include && opts.include.length) {
    includeMatcher = picomatch(opts.include, opts.match);
  }

  if (opts && opts.exclude && opts.exclude.length) {
    excludeMatcher = picomatch(opts.exclude, opts.match);
  }

  return {includeMatcher, excludeMatcher};
}

const rrdir = module.exports = async (dir, opts) => {
  const {includeMatcher, excludeMatcher} = makeMatchers(opts);
  if (isExcluded(dir, excludeMatcher)) return [];
  opts = Object.assign({}, defaults, opts);
  const results = [];
  let entries = [];

  try {
    entries = await readdir(dir, {encoding: opts.encoding, withFileTypes: true});
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
    if (isExcluded(path, excludeMatcher)) continue;
    if (!isIncluded(entry, includeMatcher)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = await (opts.followSymlinks ? stat(path) : lstat(path));
      } catch (err) {
        if (opts.strict) throw err;
        results.push({path, err});
      }
      if (stats && canInclude(entry, opts)) results.push(build(entry, path, stats));
    } else {
      if (canInclude(entry, opts)) results.push(build(entry, path));
    }

    if (entry.isDirectory()) results.push(...await rrdir(path, opts));
  }

  return results;
};

module.exports.sync = (dir, opts) => {
  const {includeMatcher, excludeMatcher} = makeMatchers(opts);
  if (isExcluded(dir, excludeMatcher)) return [];
  opts = Object.assign({}, defaults, opts);
  const results = [];
  let entries = [];

  try {
    entries = readdirSync(dir, {encoding: opts.encoding, withFileTypes: true});
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
    if (isExcluded(path, excludeMatcher)) continue;
    if (!isIncluded(entry, includeMatcher)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = opts.followSymlinks ? statSync(path) : lstatSync(path);
      } catch (err) {
        if (opts.strict) throw err;
        results.push({path, err});
      }
      if (stats && canInclude(entry, opts)) results.push(build(entry, path, stats));
    } else {
      if (canInclude(entry, opts)) results.push(build(entry, path));
    }

    if (entry.isDirectory()) results.push(...rrdir.sync(path, opts));
  }

  return results;
};

module.exports.stream = async function* (dir, opts) {
  const {includeMatcher, excludeMatcher} = makeMatchers(opts);
  if (isExcluded(dir, excludeMatcher)) return;
  opts = Object.assign({}, defaults, opts);
  let entries = [];

  try {
    entries = await readdir(dir, {encoding: opts.encoding, withFileTypes: true});
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
    if (isExcluded(path, excludeMatcher)) continue;
    if (!isIncluded(entry, includeMatcher)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = await (opts.followSymlinks ? stat(path) : lstat(path));
      } catch (err) {
        if (opts.strict) throw err;
        yield {path, err};
      }
      if (stats && canInclude(entry, opts)) yield build(entry, path, stats);
    } else {
      if (canInclude(entry, opts)) yield build(entry, path);
    }

    if (entry.isDirectory()) yield* await rrdir.stream(path, opts);
  }
};

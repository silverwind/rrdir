"use strict";

const fs = require("fs");
const {promisify} = require("util");
const {join, basename} = require("path");
const multimatch = require("multimatch");

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const lstat = promisify(fs.lstat);

const defaults = {
  encoding: "utf8",
  strict: false,
  stats: false,
  followSymlinks: true,
  exclude: [],
  include: [],
  minimatch: {
    matchBase: true,
    dot: true,
    nocomment: true,
  }
};

function isExcluded(path, opts) {
  if (!opts || !opts.exclude || !opts.exclude.length) return false;
  return Boolean(multimatch(basename(path), opts.exclude, opts.minimatch).length);
}

function isIncluded(entry, opts) {
  if (!opts || !opts.include || !opts.include.length || entry.isDirectory()) return true;
  return Boolean(multimatch(entry.name, opts.include, opts.minimatch).length);
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

const rrdir = module.exports = async (dir, opts) => {
  if (isExcluded(dir, opts)) return [];
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
    if (isExcluded(path, opts)) continue;
    if (!isIncluded(entry, opts)) continue;

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
  if (isExcluded(dir, opts)) return [];
  opts = Object.assign({}, defaults, opts);
  const results = [];
  let entries = [];

  try {
    entries = fs.readdirSync(dir, {encoding: opts.encoding, withFileTypes: true});
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
    if (isExcluded(path, opts)) continue;
    if (!isIncluded(entry, opts)) continue;

    let stats;
    if (opts.stats) {
      try {
        stats = opts.followSymlinks ? fs.statSync(path) : fs.lstatSync(path);
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
  if (isExcluded(dir, opts)) return;
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
    if (isExcluded(path, opts)) continue;
    if (!isIncluded(entry, opts)) continue;

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

"use strict";

const fs = require("fs");
const {promisify} = require("util");
const {join} = require("path");
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
  minimatch: {
    matchBase: true,
    dot: true,
    nocomment: true,
  }
};

const rrdir = module.exports = async (dir, opts) => {
  opts = Object.assign({}, defaults, opts);

  if (!dir || !typeof dir === "string") {
    throw new Error(`Expected a string, got '${dir}'`);
  }

  let results = [];
  let entries = [];

  try {
    const exclude = (opts.exclude.length) && !!(multimatch(dir, opts.exclude, opts.minimatch).length);
    if (!exclude) {
      entries = await readdir(dir, {encoding: opts.encoding, withFileTypes: true});
    }
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      results.push({path: dir, err});
    }
  }

  if (!entries.length) {
    return entries;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (opts.exclude.length && !!(multimatch(path, opts.exclude, opts.minimatch).length)) {
      continue;
    }

    let stats;
    if (!opts.stats) {
      stats = entry;
    } else {
      try {
        stats = await (opts.followSymlinks ? stat(path) : lstat(path));
      } catch (err) {
        if (opts.strict) {
          throw err;
        } else {
          results.push({path, err});
        }
      }
    }

    if (stats) {
      const directory = stats.isDirectory();
      const symlink = stats.isSymbolicLink();
      const entry = {path, directory, symlink};
      if (opts.stats) entry.stats = stats;
      results.push(entry);

      if (directory) {
        results = results.concat(await rrdir(path, opts));
      }
    }
  }

  return results;
};

module.exports.sync = (dir, opts) => {
  opts = Object.assign({}, defaults, opts);

  let results = [];
  let entries = [];

  try {
    const exclude = (opts.exclude.length) && !!(multimatch(dir, opts.exclude, opts.minimatch).length);
    if (!exclude) {
      entries = fs.readdirSync(dir, {encoding: opts.encoding, withFileTypes: true});
    }
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      results.push({path: dir, err});
    }
  }

  if (!entries.length) {
    return entries;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (opts.exclude.length && !!(multimatch(path, opts.exclude, opts.minimatch).length)) {
      continue;
    }

    let stats;
    if (!opts.stats) {
      stats = entry;
    } else {
      try {
        stats = opts.followSymlinks ? fs.statSync(path) : fs.lstatSync(path);
      } catch (err) {
        if (opts.strict) {
          throw err;
        } else {
          results.push({path, err});
        }
      }
    }

    if (stats) {
      const directory = stats.isDirectory();
      const symlink = stats.isSymbolicLink();
      const entry = {path, directory, symlink};
      if (opts.stats) entry.stats = stats;
      results.push(entry);

      if (directory) {
        results = results.concat(rrdir.sync(path, opts));
      }
    }
  }

  return results;
};

module.exports.stream = async function* (dir, opts) {
  opts = Object.assign({}, defaults, opts);

  if (!dir || !typeof dir === "string") {
    throw new Error(`Expected a string, got '${dir}'`);
  }

  let entries = [];

  try {
    const exclude = (opts.exclude.length) && !!(multimatch(dir, opts.exclude, opts.minimatch).length);
    if (!exclude) {
      entries = await readdir(dir, {encoding: opts.encoding, withFileTypes: true});
    }
  } catch (err) {
    if (opts.strict) {
      throw err;
    } else {
      yield {path: dir, err};
    }
  }

  if (!entries.length) {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (opts.exclude.length && !!(multimatch(path, opts.exclude, opts.minimatch).length)) {
      continue;
    }

    let stats;
    if (!opts.stats) {
      stats = entry;
    } else {
      try {
        stats = await (opts.followSymlinks ? stat(path) : lstat(path));
      } catch (err) {
        if (opts.strict) {
          throw err;
        } else {
          yield {path, err};
        }
      }
    }

    if (stats) {
      const directory = stats.isDirectory();
      const symlink = stats.isSymbolicLink();
      const entry = {path, directory, symlink};
      if (opts.stats) entry.stats = stats;
      yield entry;

      if (directory) {
        yield * await rrdir.stream(path, opts);
      }
    }
  }
};

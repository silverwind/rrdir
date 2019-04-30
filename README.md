# rrdir
[![](https://img.shields.io/npm/v/rrdir.svg?style=flat)](https://www.npmjs.org/package/rrdir) [![](https://img.shields.io/npm/dm/rrdir.svg)](https://www.npmjs.org/package/rrdir) [![](https://api.travis-ci.org/silverwind/rrdir.svg?style=flat)](https://travis-ci.org/silverwind/rrdir)

> Recursive directory crawler with a delightful API

## Installation
```console
npm i rrdir
```

## Examples
```js
const rrdir = require("rrdir");

const entries = await rrdir("../dir");
// => [{path: '../dir/file1', directory: false, symlink: true}]

const entries = rrdir.sync("../dir");
// => [{path: '../dir/file1', directory: false, symlink: true}]

for await (const entry of rrdir.stream("../dir")) {
  // => {path: '../dir/file1', directory: false, symlink: true}
}

```

## API

### `rrdir(dir, [options])`
### `rrdir.sync(dir, [options])`
### `rrdir.stream(dir, [options])`

Recursively searches a directory for entries contained within. Will reject or throw on unexpected errors, but can optionally ignore errors encountered on individual files. `rrdir` and `rrdir.sync` return an array of `entry`, `rrdir.stream` is a async iterator which yields `entry`.

#### `options`

- `options.stats` *boolean*: Include `entry.stats`. Will reduce performance. Default: `false`.
- `options.followSymlinks` *boolean*: Whether to follow symlinks when `options.stats` is enabled. Default: `true`.
- `options.exclude` *Array*: Path globs to exclude from the result. Default: `[]`.
- `options.strict` *boolean*: Whether to throw immediately when reading an entry fails. Default: `false`.
- `options.encoding` *string*: The encoding to use on `entry.path`. Default: `'utf8'`.
- `options.minimatch` *Object*: [minimatch options](https://github.com/isaacs/minimatch#options). Default: `{matchBase: true, dot: true, nocomment: true}`.

#### `entry`

- `entry.path` *string*: The path to the entry, will be relative if `dir` is given relative.
- `entry.directory` *boolean*: Boolean indicating whether the entry is a directory. `undefined` on error.
- `entry.symlink` *boolean*: Boolean indicating whether the entry is a symbolic link. `undefined` on error.
- `entry.stats` *Object*: A [`fs.stats`](https://nodejs.org/api/fs.html#fs_class_fs_stats) object, present when `options.stats` is set. `undefined` on error.
- `entry.err` *Error*: Any error encountered while reading this entry. `undefined` on success.

© [silverwind](https://github.com/silverwind), distributed under BSD licence

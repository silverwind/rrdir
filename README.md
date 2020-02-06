# rrdir
[![](https://img.shields.io/npm/v/rrdir.svg?style=flat)](https://www.npmjs.org/package/rrdir) [![](https://img.shields.io/npm/dm/rrdir.svg)](https://www.npmjs.org/package/rrdir) [![](https://api.travis-ci.org/silverwind/rrdir.svg?style=flat)](https://travis-ci.org/silverwind/rrdir)

> Recursive directory reader with a delightful API

`rrdir` recursively reads a directory and returns entries within via an async iterator or array. It has minimal dependencies and can typically iterate millions of files in a matter of seconds. Memory usage is `O(1)` for the iterator and `O(n)` for the array variants.

## Installation
```console
npm i rrdir
```

## Examples
```js
const rrdir = require("rrdir");

for await (const entry of rrdir.stream("dir")) {
  // => {path: 'dir/file', directory: false, symlink: true}
}

const entries = await rrdir("dir");
// => [{path: 'dir/file', directory: false, symlink: true}]

const entries = rrdir.sync("dir");
// => [{path: 'dir/file', directory: false, symlink: true}]

```

## API

### `rrdir(dir, [options])`
### `rrdir.stream(dir, [options])`
### `rrdir.sync(dir, [options])`

Recursively read a directory for entries contained within. `rrdir` and `rrdir.sync` return an array of `entry`, `rrdir.stream` is a async iterator which yields `entry`. By default, errors while reading files will be ignored and put in `entry.err`.

#### `options`

- `options.stats` *boolean*: Whether to include `entry.stats`. Will reduce performance. Default: `false`.
- `options.followSymlinks` *boolean*: Whether to follow symlinks when `options.stats` is enabled. Default: `true`.
- `options.exclude` *Array*: File and directory globs to exclude. Default: `[]`.
- `options.include` *Array*: File globs to include. When specified, will stop yielding directories. Default: `[]`.
- `options.strict` *boolean*: Whether to throw immediately when reading an entry fails. Default: `false`.
- `options.encoding` *string*: The encoding to use on `entry.path`. Default: `'utf8'`.
- `options.match` *Object*: [picomatch options](https://github.com/micromatch/picomatch#options). Default: `{dot: true}`.

#### `entry`

- `entry.path` *string*: The path to the entry, will be relative if `dir` is given relative. Always present.
- `entry.directory` *boolean*: Boolean indicating whether the entry is a directory. `undefined` on error.
- `entry.symlink` *boolean*: Boolean indicating whether the entry is a symbolic link. `undefined` on error.
- `entry.stats` *Object*: A [`fs.stats`](https://nodejs.org/api/fs.html#fs_class_fs_stats) object, present when `options.stats` is set. `undefined` on error.
- `entry.err` *Error*: Any error encountered while reading this entry. `undefined` on success.

© [silverwind](https://github.com/silverwind), distributed under BSD licence

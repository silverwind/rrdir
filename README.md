# rrdir
[![](https://img.shields.io/npm/v/rrdir.svg?style=flat)](https://www.npmjs.org/package/rrdir) [![](https://img.shields.io/npm/dm/rrdir.svg)](https://www.npmjs.org/package/rrdir) [![](https://api.travis-ci.org/silverwind/rrdir.svg?style=flat)](https://travis-ci.org/silverwind/rrdir)

> The fastest recursive readdir in town

Recursively crawls a directory to obtain paths and information on directory/symlink on each entry. Takes advantage of `uv_fs_scandir` in Node.js 10.10 or higher, which increases performance significantly.

Comparison against the `walkdir` module crawling the [Node.js repository](https://github.com/nodejs/node) on a NVMe SSD:

| Test            | Engine          | OS           | Runtime |
|-----------------|-----------------|--------------|---------|
| **rrdir** sync  | Node.js 10.10.0 | Linux 4.18.4 | 0.289s  |
| **rrdir** async | Node.js 10.10.0 | Linux 4.18.4 | 0.400s  |
| walkdir sync    | Node.js 10.10.0 | Linux 4.18.4 | 0.423s  |
| walkdir async   | Node.js 10.10.0 | Linux 4.18.4 | 1.557s  |
| **rrdir** sync  | Node.js 8.11.4  | Linux 4.18.4 | 0.383s  |
| walkdir sync    | Node.js 8.11.4  | Linux 4.18.4 | 0.416s  |
| **rrdir** async | Node.js 8.11.4  | Linux 4.18.4 | 1.148s  |
| walkdir async   | Node.js 8.11.4  | Linux 4.18.4 | 1.813s  |

## Installation
```console
npm i rrdir
```

## Examples
```js
const rrdir = require('rrdir');
const entries = await rrdir('../dir'); // => [{path: '../dir/file1', directory: false, symlink: true}]
const entries = rrdir.sync('../dir'); // => [{path: '../dir/file1', directory: false, symlink: true}]
```

## API

### `rrdir(dir, [options])`
### `rrdir.sync(dir, [options])`

Recursively searches a directory for entries contained within. Both functions will reject or throw on unexpected errors, but can optionally ignore errors encountered on individual files. Returns an array of `entry`.

#### `entry`

- `entry.path` *string*: The path to the entry, will be relative if `dir` is given relative.
- `entry.directory` *boolean*: Boolean indicating whether the entry is a directory.
- `entry.symlink` *boolean*: Boolean indicating whether the entry is a symbolic link.
- `entry.stats` *Object*: A [`fs.stats`](https://nodejs.org/api/fs.html#fs_class_fs_stats) object, present when `option.stats` is set.

#### `options`

- `options.strict` *boolean*: Whether to throw errors when reading fails. Default: `false`.
- `options.encoding` *string*: The encoding to use in the entry's path. Default: `'utf8'`.
- `options.exclude` *Array*: Array of path globs to exclude from the result. Default: `[]`.
- `options.minimatch` *Object*: [minimatch options](https://github.com/isaacs/minimatch#options). Default: `{matchBase: true, dot: true, nocomment: true}`.
- `options.stats` *boolean*: Include a `stats` object in an `entry`. Will reduce performance. Default: `false`.

© [silverwind](https://github.com/silverwind), distributed under BSD licence

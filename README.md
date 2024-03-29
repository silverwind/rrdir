# rrdir
[![](https://img.shields.io/npm/v/rrdir.svg?style=flat)](https://www.npmjs.org/package/rrdir) [![](https://img.shields.io/npm/dm/rrdir.svg)](https://www.npmjs.org/package/rrdir) [![](https://packagephobia.com/badge?p=rrdir)](https://packagephobia.com/result?p=rrdir)

> Recursive directory reader with a delightful API

`rrdir` recursively reads a directory and returns entries within via an async iterator or async/sync as Array. It can typically iterate millions of files in a matter of seconds. Memory usage is `O(1)` for the async iterator and `O(n)` for the Array variants.

Contrary to other similar modules, this module is optionally able to read any path including ones that contain invalid UTF-8 sequences.

## Usage
```console
npm i rrdir
```
```js
import {rrdir, rrdirAsync, rrdirSync} from "rrdir";

for await (const entry of rrdir("dir")) {
  // => {path: 'dir/file', directory: false, symlink: false}
}

const entries = await rrdirAsync("dir");
// => [{path: 'dir/file', directory: false, symlink: false}]

const entries = rrdirSync("dir");
// => [{path: 'dir/file', directory: false, symlink: false}]

```

## API
### `rrdir(dir, [options])`
### `rrdirAsync(dir, [options])`
### `rrdirSync(dir, [options])`

`rrdir` is an async iterator which yields `entry`. `rrdirAsync` and `rrdirSync` return an Array of `entry`.

#### `dir` *String* | *Uint8Array*

The directory to read, either absolute or relative. Pass a `Uint8Array` to switch the module into `Uint8Array` mode which is required to be able to read every file, like for example files with names that are invalid UTF-8 sequences.

#### `options` *Object*

- `stats` *boolean*: Whether to include `entry.stats`. Will reduce performance. Default: `false`.
- `followSymlinks` *boolean*: Whether to follow symlinks for both recursion and `stat` calls. Default: `false`.
- `exclude` *Array*: Path globs to exclude, e.g. `["**.js"]`. Default: `undefined`.
- `include` *Array*: Path globs to include, e.g. `["**.map"]`. Default: `undefined`.
- `strict` *boolean*: Whether to throw immediately when reading an entry fails. Default: `false`.
- `insensitive` *boolean*: Whether `include` and `exclude` match case-insensitively. Default: `false`.

#### `entry` *Object*

- `path` *string* | *Uint8Array*: The path to the entry, will be relative if `dir` is given relative. If `dir` is a `Uint8Array`, this will be too. Always present.
- `directory` *boolean*: Boolean indicating whether the entry is a directory. `undefined` on error.
- `symlink` *boolean*: Boolean indicating whether the entry is a symbolic link. `undefined` on error.
- `stats` *Object*: A [`fs.stats`](https://nodejs.org/api/fs.html#fs_class_fs_stats) object, present when `options.stats` is set. `undefined` on error.
- `err` *Error*: Any error encountered while reading this entry. `undefined` on success.

© [silverwind](https://github.com/silverwind), distributed under BSD licence

"use strict";

const rrdir = require(".");
const tempy = require("tempy");
const del = require("del");
const {chdir} = require("process");
const {join} = require("path");
const {test, expect, beforeAll, afterAll} = global;
const {writeFileSync, mkdirSync, symlinkSync} = require("fs");
const testDir = tempy.directory();

beforeAll(() => {
  chdir(testDir);
  mkdirSync(join("test"));
  mkdirSync(join("test/dir"));
  mkdirSync(join("test/dir2"));
  writeFileSync(join("test/file"));
  writeFileSync(join("test/dir/file"));
  writeFileSync(join("test/dir2/file"));
  symlinkSync(join("file"), join(("test/filesymlink")));
  symlinkSync(join("dir"), join(("test/dirsymlink")));
});

afterAll(() => {
  del.sync(testDir, {force: true});
});

function sort(entries) {
  return entries.sort((a, b) => {
    if ("path" in a && "path" in b) return a.path.localeCompare(b.path);
    return 0;
  });
}

function makeTest(dir, opts, expected) {
  return async () => {
    const streamResults = [];
    for await (const result of rrdir.stream(dir, opts)) streamResults.push(result);
    const asyncResults = await rrdir(dir, opts);
    const syncResults = rrdir.sync(dir, opts);

    if (typeof expected === "function") {
      expected(streamResults);
      expected(asyncResults);
      expected(syncResults);
    } else {
      expect(sort(streamResults)).toEqual(sort(expected));
      expect(sort(asyncResults)).toEqual(sort(expected));
      expect(sort(syncResults)).toEqual(sort(expected));
    }
  };
}

test("basic", makeTest("test", undefined, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("basic slash", makeTest("test/", undefined, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("followSymlinks", makeTest("test", {followSymlinks: true}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: false},
  {path: join("test/dirsymlink"), directory: true, symlink: false},
  {path: join("test/dirsymlink/file"), directory: false, symlink: false},
]));

test("stats", makeTest("test", {stats: true}, result => {
  for (const entry of result) expect(entry.stats).toBeTruthy();
}));

test("nostats", makeTest("test", {stats: false}, result => {
  for (const entry of result) expect(entry.stats).toEqual(undefined);
}));

test("cwd", makeTest(".", undefined, [
  {path: join("test"), directory: true, symlink: false},
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("cwdslash", makeTest("./", undefined, [
  {path: join("test"), directory: true, symlink: false},
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude", makeTest("test", {exclude: ["**/dir"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude 2", makeTest("test", {exclude: ["**/dir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude 3", makeTest("test", {exclude: ["**/dir*"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
]));

test("exclude 4", makeTest("test", {exclude: ["**/dir", "**/dir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude 5", makeTest("test", {exclude: ["**"]}, []));

test("exclude stats", makeTest("test", {exclude: ["**/dir", "**/dir2"], stats: true}, result => {
  const file = result.find(entry => entry.path === join("test/file"));
  expect(file.stats.isFile()).toEqual(true);
}));

test("include", makeTest("test", {include: ["**/f*"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
]));

test("include 2", makeTest("test", {include: ["**"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("include 3", makeTest("test", {include: ["**/dir2/**"]}, [
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
]));

test("include 4", makeTest("test", {include: ["**/dir/"]}, []));

test("include 5", makeTest("test", {include: ["**/dir"]}, [
  {path: join("test/dir"), directory: true, symlink: false},
]));

test("exclude include", makeTest("test", {exclude: ["**/dir2"], include: ["**/file"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
]));

test("error", makeTest("notfound", undefined, results => {
  expect(results.length).toEqual(1);
  expect(results[0].path).toEqual("notfound");
  expect(results[0].err).toBeTruthy();
}));

test("error strict", async () => {
  await expect(rrdir("notfound", {strict: true})).rejects.toThrow();
  expect(() => rrdir.sync("notfound", {strict: true})).toThrow();
  await expect(rrdir.stream("notfound", {strict: true}).next()).rejects.toThrow();
});

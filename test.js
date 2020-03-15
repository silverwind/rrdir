"use strict";

const rrdir = require(".");
const tempy = require("tempy");
const del = require("del");
const {chdir} = require("process");
const {join} = require("path");
const {test, expect, beforeAll, afterAll} = global;
const {writeFileSync, mkdirSync} = require("fs");
const testDir = tempy.directory();

beforeAll(() => {
  chdir(testDir);
  mkdirSync("test");
  mkdirSync("test/subdir");
  mkdirSync("test/subdir2");
  writeFileSync("test/file");
  writeFileSync("test/subdir/file");
  writeFileSync("test/subdir2/file");
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
  {path: join("test/subdir"), directory: true, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
  {path: join("test/subdir2"), directory: true, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("basic slash", makeTest("test/", undefined, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir"), directory: true, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
  {path: join("test/subdir2"), directory: true, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("cwd", makeTest(".", undefined, [
  {path: join("test"), directory: true, symlink: false},
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir"), directory: true, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
  {path: join("test/subdir2"), directory: true, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("cwdslash", makeTest("./", undefined, [
  {path: join("test"), directory: true, symlink: false},
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir"), directory: true, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
  {path: join("test/subdir2"), directory: true, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("exclude", makeTest("test", {exclude: ["**/subdir"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir2"), directory: true, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("exclude 2", makeTest("test", {exclude: ["**/subdir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir"), directory: true, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
]));

test("exclude 3", makeTest("test", {exclude: ["**/sub*"]}, [
  {path: join("test/file"), directory: false, symlink: false},
]));

test("exclude 4", makeTest("test", {exclude: ["**/subdir", "**/subdir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
]));

test("exclude 5", makeTest("test", {exclude: ["**"]}, []));

test("exclude stats", makeTest("test", {exclude: ["**/subdir", "**/subdir2"], stats: true}, result => {
  expect(result[0].stats.isFile()).toEqual(true);
}));

test("include", makeTest("test", {include: ["**/f*"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("include 2", makeTest("test", {include: ["**"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir"), directory: true, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
  {path: join("test/subdir2"), directory: true, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("include 3", makeTest("test", {include: ["**/subdir2/**"]}, [
  {path: join("test/subdir2"), directory: true, symlink: false},
  {path: join("test/subdir2/file"), directory: false, symlink: false},
]));

test("include 4", makeTest("test", {include: ["**/subdir/"]}, []));

test("include 5", makeTest("test", {include: ["**/subdir"]}, [
  {path: join("test/subdir"), directory: true, symlink: false},
]));

test("exclude include", makeTest("test", {exclude: ["**/subdir2"], include: ["**/file"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test/subdir/file"), directory: false, symlink: false},
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

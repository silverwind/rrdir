"use strict";

const rrdir = require(".");
const tempy = require("tempy");
const del = require("del");
const {chdir} = require("process");
const {join} = require("path");
const {test, expect, beforeAll, afterAll} = global;
const {writeFile, mkdir, symlink, readFile} = require("fs").promises;
const {versions} = require("process");
const {platform} = require("os");

const testDir = tempy.directory();
const weirdName = String(Buffer.from([0x78, 0xef, 0xbf, 0xbd, 0x78]));

// node v10 on windows apparently can not symlink directories
const nodeVersion = parseInt(versions.node);
const skipSymlink = nodeVersion < 12 && platform() === "win32";

beforeAll(async () => {
  chdir(testDir);
  await mkdir(join("test"));
  await mkdir(join("test/dir"));
  await mkdir(join("test/dir2"));
  await writeFile(join("test/file"), "test");
  await writeFile(join("test/dir/file"), "test");
  await writeFile(join("test/dir2/file"), "test");
  await writeFile(join("test", weirdName), "test");
  await symlink(join("file"), join(("test/filesymlink")));
  await symlink(join("dir"), join(("test/dirsymlink")));
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
    const iteratorResults = [];
    for await (const result of rrdir(dir, opts)) iteratorResults.push(result);
    const asyncResults = await rrdir.async(dir, opts);
    const syncResults = rrdir.sync(dir, opts);

    if (typeof expected === "function") {
      expected(iteratorResults);
      expected(asyncResults);
      expected(syncResults);
    } else {
      expect(sort(iteratorResults)).toEqual(sort(expected));
      expect(sort(asyncResults)).toEqual(sort(expected));
      expect(sort(syncResults)).toEqual(sort(expected));
    }
  };
}

test("basic", makeTest("test", undefined, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test", weirdName), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("basic slash", makeTest("test/", undefined, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test", weirdName), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

if (!skipSymlink) {
  test("followSymlinks", makeTest("test", {followSymlinks: true}, [
    {path: join("test/file"), directory: false, symlink: false},
    {path: join("test", weirdName), directory: false, symlink: false},
    {path: join("test/dir"), directory: true, symlink: false},
    {path: join("test/dir/file"), directory: false, symlink: false},
    {path: join("test/dir2"), directory: true, symlink: false},
    {path: join("test/dir2/file"), directory: false, symlink: false},
    {path: join("test/filesymlink"), directory: false, symlink: false},
    {path: join("test/dirsymlink"), directory: true, symlink: false},
    {path: join("test/dirsymlink/file"), directory: false, symlink: false},
  ]));
}

test("stats", makeTest("test", {stats: true}, result => {
  for (const entry of result) expect(entry.stats).toBeTruthy();
}));

test("nostats", makeTest("test", {stats: false}, result => {
  for (const entry of result) expect(entry.stats).toEqual(undefined);
}));

test("cwd", makeTest(".", undefined, [
  {path: join("test"), directory: true, symlink: false},
  {path: join("test", weirdName), directory: false, symlink: false},
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
  {path: join("test", weirdName), directory: false, symlink: false},
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
  {path: join("test", weirdName), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude 2", makeTest("test", {exclude: ["**/dir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test", weirdName), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude 3", makeTest("test", {exclude: ["**/dir*"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test", weirdName), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
]));

test("exclude 4", makeTest("test", {exclude: ["**/dir", "**/dir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  {path: join("test", weirdName), directory: false, symlink: false},
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
  {path: join("test", weirdName), directory: false, symlink: false},
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
  await expect(rrdir("notfound", {strict: true}).next()).rejects.toThrow();
  await expect(rrdir.async("notfound", {strict: true})).rejects.toThrow();
  expect(() => rrdir.sync("notfound", {strict: true})).toThrow();
});

test("read weird", makeTest("test", {include: ["**/x*"]}, async result => {
  const path = join(testDir, result[0].path);
  expect(await readFile(path, "utf8")).toEqual("test");
}));

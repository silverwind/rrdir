"use strict";

const rrdir = require(".");
const del = require("del");
const tempy = require("tempy");
const {chdir} = require("process");
const {join, sep} = require("path");
const {test, expect, beforeAll, afterAll} = global;
const {writeFile, mkdir, symlink, rmdir} = require("fs").promises;
const {platform} = require("os");
const semver = require("semver");

const sepBuffer = Buffer.from(sep);
const testDir = tempy.directory();
const weirdBuffer = Buffer.from([0x78, 0xf6, 0x6c, 0x78]); // this buffer does not round-trip through utf8 en/decoding and throws EILSEQ in darwin
const weirdString = String(weirdBuffer);

const hasRecursiveRmdir = semver.gte(process.versions.node, "12.10.0");
const isWindows = platform() === "win32";
const skipSymlink = isWindows; // node on windows apparently sometimes can not follow symlink directories
const skipWeird = (platform() === "darwin" || !hasRecursiveRmdir || isWindows);

beforeAll(async () => {
  chdir(testDir);
  await mkdir(join("test"));
  await mkdir(join("test/dir"));
  await mkdir(join("test/dir2"));
  await writeFile(join("test/file"), "test");
  await writeFile(join("test/dir/file"), "test");
  await writeFile(join("test/dir2/file"), "test");
  if (!skipWeird) await writeFile(Buffer.from([...Buffer.from("test"), ...sepBuffer, ...weirdBuffer]), "test");
  await symlink(join("file"), join(("test/filesymlink")));
  await symlink(join("dir"), join(("test/dirsymlink")));
});

afterAll(async () => {
  if (hasRecursiveRmdir && !isWindows) {
    await rmdir(testDir, {recursive: true, maxRetries: isWindows ? 50 : 0});
  } else if (skipWeird) {
    await del(testDir, {force: true});
  }
});

function sort(entries = []) {
  return entries.sort((a, b) => {
    if (!("path" in a) || !("path" in b)) return 0;
    return String(a.path).localeCompare(String(b.path));
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
      expected = expected.filter(v => !!v);
      expect(sort(iteratorResults)).toEqual(sort(expected));
      expect(sort(asyncResults)).toEqual(sort(expected));
      expect(sort(syncResults)).toEqual(sort(expected));
    }
  };
}

test("basic", makeTest("test", undefined, [
  {path: join("test/file"), directory: false, symlink: false},
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("basic slash", makeTest("test/", undefined, [
  {path: join("test/file"), directory: false, symlink: false},
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
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
    !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
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
  for (const {path, stats} of result) {
    if (path.includes(weirdString)) continue;
    expect(stats).toBeTruthy();
  }
}));

test("stats buffer", makeTest(Buffer.from("test"), {stats: true}, result => {
  for (const {stats} of result) {
    expect(stats).toBeTruthy();
  }
}));

test("nostats", makeTest("test", {stats: false}, result => {
  for (const entry of result) expect(entry.stats).toEqual(undefined);
}));

test("cwd", makeTest(".", undefined, [
  {path: join("test"), directory: true, symlink: false},
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
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
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
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
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
  {path: join("test/dir2"), directory: true, symlink: false},
  {path: join("test/dir2/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude 2", makeTest("test", {exclude: ["**/dir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
  {path: join("test/dir"), directory: true, symlink: false},
  {path: join("test/dir/file"), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
  {path: join("test/dirsymlink"), directory: false, symlink: true},
]));

test("exclude 3", makeTest("test", {exclude: ["**/dir*"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
  {path: join("test/filesymlink"), directory: false, symlink: true},
]));

test("exclude 4", makeTest("test", {exclude: ["**/dir", "**/dir2"]}, [
  {path: join("test/file"), directory: false, symlink: false},
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
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
  !skipWeird && {path: join("test", weirdString), directory: false, symlink: false},
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

test("buffer", makeTest(Buffer.from("test"), undefined, result => {
  for (const entry of result) {
    expect(Buffer.isBuffer(entry.path)).toEqual(true);
  }
}));

if (!skipWeird) {
  test("weird as string", makeTest("test", {include: ["**/x*"]}, async result => {
    expect(Buffer.from(result[0].path).includes(weirdBuffer)).toEqual(false);
  }));

  test("weird as buffer", makeTest(Buffer.from("test"), {include: ["**/x*"]}, async result => {
    expect(result[0].path.includes(weirdBuffer)).toEqual(true);
  }));
}

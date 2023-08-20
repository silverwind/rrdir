import {rrdir, rrdirAsync, rrdirSync} from "./index.js";
import {join, sep, relative} from "node:path";
import {writeFile, mkdir, symlink, rm} from "node:fs/promises";
import {mkdtempSync} from "node:fs";
import {platform, tmpdir} from "node:os";

const sepBuffer = Buffer.from(sep);

// this buffer does not round-trip through utf8 en/decoding and throws EILSEQ in darwin
const weirdBuffer = Buffer.from([0x78, 0xf6, 0x6c, 0x78]);
const weirdString = String(weirdBuffer);

// node on windows apparently sometimes can not follow symlink directories
const isWindows = platform() === "win32";
const skipSymlink = isWindows;

const skipWeird = platform() === "darwin" || isWindows;
const testDir = mkdtempSync(join(tmpdir(), "rrdir-"));

function joinBuffer(a, b) {
  return Buffer.from([...Buffer.from(a), ...sepBuffer, ...Buffer.from(b)]);
}

beforeAll(async () => {
  await mkdir(join(testDir, "test"));
  await mkdir(join(testDir, "test/dir"));
  await mkdir(join(testDir, "test/dir2"));
  await writeFile(join(testDir, "test/file"), "test");
  await writeFile(join(testDir, "test/dir/file"), "test");
  await writeFile(join(testDir, "test/dir2/file"), "test");
  await writeFile(join(testDir, "test/dir2/UPPER"), "test");
  await writeFile(join(testDir, "test/dir2/exclude.txt"), "test");
  if (!skipWeird) await writeFile(joinBuffer(join(testDir, "test"), weirdBuffer), "test");
  await symlink(join(testDir, "test/file"), join(testDir, "test/filesymlink"));
  await symlink(join(testDir, "test/dir"), join(testDir, "test/dirsymlink"));
});

afterAll(async () => {
  await rm(testDir, {recursive: true});
});

function sort(entries = []) {
  return entries.sort((a, b) => {
    if (!("path" in a) || !("path" in b)) return 0;
    return String(a.path).localeCompare(String(b.path));
  });
}

function normalize(results) {
  const ret = [];
  for (const item of sort(results)) {
    if (typeof item?.path === "string") {
      item.path = relative(testDir, item.path).replaceAll("\\", "/");
    }
    if (item?.path?.endsWith("lx")) continue; // weird "test/x�lx" files on github actions linux
    ret.push(item);
  }
  return ret;
}

function makeTest(dir, opts, expected) {
  if (typeof dir === "string") {
    dir = join(testDir, dir);
  } else {
    dir = joinBuffer(testDir, dir);
  }
  return async () => {
    let iteratorResults = [];
    for await (const result of rrdir(dir, opts)) iteratorResults.push(result);
    let asyncResults = await rrdirAsync(dir, opts);
    let syncResults = rrdirSync(dir, opts);

    if (typeof expected === "function") {
      expected(iteratorResults);
      expected(asyncResults);
      expected(syncResults);
    } else {
      iteratorResults = normalize(iteratorResults);
      asyncResults = normalize(asyncResults);
      syncResults = normalize(syncResults);
      expect(iteratorResults).toMatchSnapshot();
      expect(syncResults).toEqual(iteratorResults);
      expect(asyncResults).toEqual(iteratorResults);
    }
  };
}

test("basic", makeTest("test"));
test("basic slash", makeTest("test/"));

if (!skipSymlink) {
  test("followSymlinks", makeTest("test", {followSymlinks: true}));
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

test("exclude", makeTest("test", {exclude: ["**/dir"]}));
test("exclude 2", makeTest("test", {exclude: ["**/dir2"]}));
test("exclude 3", makeTest("test", {exclude: ["**/dir*"]}));
test("exclude 4", makeTest("test", {exclude: ["**/dir", "**/dir2"]}));
test("exclude 5", makeTest("test", {exclude: ["**"]}, []));
test("exclude 6", makeTest("test", {exclude: ["**/*.txt"]}, []));

test("exclude stats", makeTest("test", {exclude: ["**/dir", "**/dir2"], stats: true}, result => {
  const file = result.find(entry => entry.path === join(testDir, "test/file"));
  expect(file.stats.isFile()).toEqual(true);
}));

// does not work on windows, likely a picomatch bug
if (!isWindows) {
  test("include", makeTest("test", {include: [join(testDir, "**/f*")]}));
}

test("include 2", makeTest("test", {include: ["**"]}));
test("include 3", makeTest("test", {include: ["**/dir2/**"]}));
test("include 4", makeTest("test", {include: ["**/dir/"]}));
test("include 5", makeTest("test", {include: ["**/dir"]}));
test("include 6", makeTest("test", {include: ["**/*.txt"]}, []));
test("insensitive", makeTest("test", {include: ["**/u*"], insensitive: true}));
test("exclude include", makeTest("test", {exclude: ["**/dir2"], include: ["**/file"]}));

test("error", makeTest("notfound", undefined, results => {
  expect(results.length).toEqual(1);
  expect(results[0].path).toMatch(/notfound$/);
  expect(results[0].err).toBeTruthy();
}));

test("error strict", async () => {
  await expect(rrdir("notfound", {strict: true}).next()).rejects.toThrow();
  await expect(rrdirAsync("notfound", {strict: true})).rejects.toThrow();
  expect(() => rrdirSync("notfound", {strict: true})).toThrow();
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

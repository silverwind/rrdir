import {rrdir, rrdirAsync, rrdirSync, type Entry, type RRDirOpts, type Dir} from "./index.ts";
import {join, sep, relative} from "node:path";
import {writeFile, mkdir, symlink, rm} from "node:fs/promises";
import {mkdtempSync} from "node:fs";
import {platform, tmpdir} from "node:os";
import type {TestContext} from "vitest";

const encoder = new TextEncoder();
const toUint8Array = encoder.encode.bind(encoder);
const decoder = new TextDecoder();
const toString: (input: AllowSharedBufferSource) => string = decoder.decode.bind(decoder);
const sepUint8Array = toUint8Array(sep);
const uint8ArrayContains = (arr: Uint8Array, subArr: Uint8Array) => arr.toString().includes(subArr.toString());

// this Uint8Array does not round-trip through utf8 en/decoding and throws EILSEQ in darwin
const weirdUint8Array = Uint8Array.from([0x78, 0xf6, 0x6c, 0x78]);
const weirdString = toString(weirdUint8Array);

// node on windows apparently sometimes can not follow symlink directories
const isWindows = platform() === "win32";

const skipWeird = platform() === "darwin" || isWindows;
const testDir = mkdtempSync(join(tmpdir(), "rrdir-"));

function joinUint8Array(a: Uint8Array | string, b: Uint8Array | string) {
  return Uint8Array.from([
    ...(a instanceof Uint8Array ? a : toUint8Array(a)),
    ...sepUint8Array,
    ...(b instanceof Uint8Array ? b : toUint8Array(b)),
  ]);
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
  await writeFile(join(testDir, "test/dir2/exclude.md"), "test");
  await writeFile(join(testDir, "test/dir2/exclude.css"), "test");
  if (!skipWeird) await writeFile(joinUint8Array(join(testDir, "test"), weirdUint8Array) as any, "test");
  await symlink(join(testDir, "test/file"), join(testDir, "test/filesymlink"));
  await symlink(join(testDir, "test/dir"), join(testDir, "test/dirsymlink"));
});

afterAll(async () => {
  await rm(testDir, {recursive: true});
});

function sort<T extends Array<Entry>>(entries: T): T {
  entries.sort((a, b) => {
    if (!("path" in a) || !("path" in b)) return 0;
    const aString = a.path instanceof Uint8Array ? toString(a.path) : a.path;
    const bString = b.path instanceof Uint8Array ? toString(b.path) : b.path;
    return aString.localeCompare(bString);
  });
  return entries;
}

function normalize<T extends Array<Entry>>(entries: T): T {
  const ret: T = [] as any;
  for (const item of sort(entries)) {
    if (typeof item?.path === "string") {
      item.path = relative(testDir, item.path).replaceAll("\\", "/");
    }
    if ((item?.path as string)?.endsWith?.("lx")) continue; // weird "test/x�lx" files on github actions linux
    ret.push(item);
  }
  return ret;
}

async function makeTest<T extends Dir>(dir: T, context: TestContext, opts?: RRDirOpts, expected?: any, skip?: boolean) {
  if (isWindows && opts?.followSymlinks) context.skip();
  if (skip) context.skip();

  if (typeof dir === "string") {
    dir = join(testDir, dir) as T;
  } else {
    dir = joinUint8Array(testDir, dir) as T;
  }

  let iteratorResults: Array<Entry> = [];
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
}

test("basic", context => makeTest("test", context));
test("basic slash", context => makeTest("test/", context));
test("followSymlinks", context => makeTest("test", context, {followSymlinks: true}));

test("stats", context => makeTest("test", context, {stats: true}, (results: Array<Entry>) => {
  for (const {path, stats} of results) {
    if ((path as string)?.includes?.(weirdString)) continue;
    expect(stats).toBeTruthy();
  }
}));

test("stats Uint8Array", context => makeTest(toUint8Array("test") as any, context, {stats: true}, (results: Array<Entry>) => {
  for (const {stats} of results) {
    expect(stats).toBeTruthy();
  }
}));

test("nostats", context => makeTest("test", context, {stats: false}, (results: Array<Entry>) => {
  for (const entry of results) expect(entry.stats).toEqual(undefined);
}));

test("exclude", context => makeTest("test", context, {exclude: ["**/dir"]}));
test("exclude 2", context => makeTest("test", context, {exclude: ["**/dir2"]}));
test("exclude 3", context => makeTest("test", context, {exclude: ["**/dir*"]}));
test("exclude 4", context => makeTest("test", context, {exclude: ["**/dir", "**/dir2"]}));
test("exclude 5", context => makeTest("test", context, {exclude: ["**"]}, []));
test("exclude 6", context => makeTest("test", context, {exclude: ["**.txt"]}, []));
test("exclude 7", context => makeTest("test", context, {exclude: ["**.txt", "**.md"]}, []));

test("exclude stats", context => makeTest("test", context, {exclude: ["**/dir", "**/dir2"], stats: true}, (results: Array<Entry>) => {
  const file = results.find(entry => entry.path === join(testDir, "test/file"));
  expect(file?.stats?.isFile()).toEqual(true);
}));

// does not work on windows, likely a picomatch bug
test("include", context => makeTest("test", context, {include: [join(testDir, "**/f*")]}, undefined, isWindows));
test("include 2", context => makeTest("test", context, {include: ["**"]}));
test("include 3", context => makeTest("test", context, {include: ["**/dir2/**"]}));
test("include 4", context => makeTest("test", context, {include: ["**/dir/"]}));
test("include 5", context => makeTest("test", context, {include: ["**/dir"]}));
test("include 6", context => makeTest("test", context, {include: ["**.txt"]}, []));
test("insensitive", context => makeTest("test", context, {include: ["**/u*"], insensitive: true}));
test("exclude include", context => makeTest("test", context, {exclude: ["**/dir2"], include: ["**/file"]}));

test("error", context => makeTest("notfound", context, undefined, (results: Array<Entry>) => {
  expect(results.length).toEqual(1);
  expect(results[0].path).toMatch(/notfound$/);
  expect(results[0].err).toBeTruthy();
}));

test("error strict", async () => {
  await expect(rrdir("notfound", {strict: true}).next()).rejects.toThrow();
  await expect(rrdirAsync("notfound", {strict: true})).rejects.toThrow();
  expect(() => rrdirSync("notfound", {strict: true})).toThrow();
});

test("Uint8Array", context => makeTest(toUint8Array("test") as any, context, undefined, (results: Array<Entry>) => {
  for (const entry of results) {
    expect(entry.path instanceof Uint8Array).toEqual(true);
  }
}));

if (!skipWeird) {
  test("weird as string", context => makeTest("test", context, {include: ["**/x*"]}, (results: Array<Entry>) => {
    expect(uint8ArrayContains(toUint8Array(results[0].path as string), weirdUint8Array)).toEqual(false);
  }));

  test("weird as Uint8Array", context => makeTest(toUint8Array("test") as any, context, {include: ["**/x*"]}, (results: Array<Entry>) => {
    expect(uint8ArrayContains(results[0].path as Uint8Array, weirdUint8Array)).toEqual(true);
  }));
}

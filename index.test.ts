import {rrdir, rrdirAsync, rrdirSync, type Entry, type RRDirOpts, type Dir} from "./index.ts";
import {join, sep, relative, parse} from "node:path";
import {writeFile, mkdir, symlink, rm, chmod} from "node:fs/promises";
import {mkdtempSync} from "node:fs";
import {platform, tmpdir} from "node:os";

const toUint8Array = (input: string) => new TextEncoder().encode(input);
const toString = (input: AllowSharedBufferSource) => new TextDecoder().decode(input);
const uint8ArrayContains = (arr: Uint8Array, subArr: Uint8Array) => Buffer.from(arr).includes(Buffer.from(subArr));

const weirdUint8Array = Uint8Array.from([0x78, 0xf6, 0x6c, 0x78]);
const weirdString = toString(weirdUint8Array);

const isWindows = platform() === "win32";

const skipWeird = platform() === "darwin" || isWindows;
const testDir = mkdtempSync(join(tmpdir(), "rrdir-"));

const joinUint8Array = (dir: string, name: Uint8Array) => Uint8Array.from([...toUint8Array(dir + sep), ...name]);

beforeAll(async () => {
  await mkdir(join(testDir, "test/dir"), {recursive: true});
  await mkdir(join(testDir, "test/dir2"));
  for (const file of ["file", "dir/file", "dir2/file", "dir2/UPPER", "dir2/exclude.txt", "dir2/exclude.md", "dir2/exclude.css"]) {
    await writeFile(join(testDir, "test", file), "test");
  }
  if (!skipWeird) await writeFile(joinUint8Array(join(testDir, "test"), weirdUint8Array) as any, "test");
  await symlink(join(testDir, "test/file"), join(testDir, "test/filesymlink"));
  await symlink(join(testDir, "test/dir"), join(testDir, "test/dirsymlink"));
});

afterAll(async () => {
  await rm(testDir, {recursive: true});
});

function normalize(entries: Array<Entry>) {
  return entries
    .map(entry => ({...entry, path: relative(testDir, entry.path as string).replaceAll("\\", "/")}))
    .filter(({path}) => !path.includes(weirdString))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function entry(path: string, directory = false, symlink = false) {
  return {path, directory, symlink};
}

async function makeTest<T extends Dir>(dir: T, opts: RRDirOpts | undefined, expected: Array<ReturnType<typeof entry>> | ((results: Array<Entry<T>>) => void)) {
  const path = (typeof dir === "string" ? join(testDir, dir) : joinUint8Array(testDir, dir)) as T;
  for (const results of [await Array.fromAsync(rrdir(path, opts)), await rrdirAsync(path, opts), rrdirSync(path, opts)]) {
    if (typeof expected === "function") expected(results);
    else expect(normalize(results)).toEqual(expected);
  }
}

const basicExpected = [
  entry("test/dir", true),
  entry("test/dir/file"),
  entry("test/dir2", true),
  entry("test/dir2/exclude.css"),
  entry("test/dir2/exclude.md"),
  entry("test/dir2/exclude.txt"),
  entry("test/dir2/file"),
  entry("test/dir2/UPPER"),
  entry("test/dirsymlink", false, true),
  entry("test/file"),
  entry("test/filesymlink", false, true),
];

test("basic", () => makeTest("test", undefined, basicExpected));
test("basic slash", () => makeTest("test/", undefined, basicExpected));
test("include all", () => makeTest("test", {include: ["**"]}, basicExpected));
test.skipIf(isWindows)("followSymlinks", () => makeTest("test", {followSymlinks: true}, [
  entry("test/dir", true),
  entry("test/dir/file"),
  entry("test/dir2", true),
  entry("test/dir2/exclude.css"),
  entry("test/dir2/exclude.md"),
  entry("test/dir2/exclude.txt"),
  entry("test/dir2/file"),
  entry("test/dir2/UPPER"),
  entry("test/dirsymlink", true),
  entry("test/dirsymlink/file"),
  entry("test/file"),
  entry("test/filesymlink"),
]));

test("path type follows dir type and stats are present only when requested", async () => {
  for (const dir of ["test", toUint8Array("test")]) {
    for (const opts of [undefined, {stats: false}, {stats: true}]) {
      await makeTest(dir, opts, (results: Array<Entry>) => {
        for (const {path, stats} of results) {
          expect(path instanceof Uint8Array).toEqual(dir instanceof Uint8Array);
          if (!opts?.stats) expect(stats).toBeUndefined();
          else if (!(path as string).includes(weirdString)) expect(stats).toBeTruthy();
        }
      });
    }
  }
});

for (const [opts, names] of [
  [{exclude: ["**/dir"]}, ["dir2", "dir2/exclude.css", "dir2/exclude.md", "dir2/exclude.txt", "dir2/file", "dir2/UPPER", "dirsymlink", "file", "filesymlink"]],
  [{exclude: ["**/dir2"]}, ["dir", "dir/file", "dirsymlink", "file", "filesymlink"]],
  [{exclude: ["**/dir*"]}, ["file", "filesymlink"]],
  [{exclude: ["**/dir", "**/dir2"]}, ["dirsymlink", "file", "filesymlink"]],
  [{exclude: ["**"]}, []],
  [{exclude: ["**.txt"]}, ["dir", "dir/file", "dir2", "dir2/exclude.css", "dir2/exclude.md", "dir2/file", "dir2/UPPER", "dirsymlink", "file", "filesymlink"]],
  [{exclude: ["**.txt", "**.md"]}, ["dir", "dir/file", "dir2", "dir2/exclude.css", "dir2/file", "dir2/UPPER", "dirsymlink", "file", "filesymlink"]],
  [{include: ["**/dir2/**"]}, ["dir2", "dir2/exclude.css", "dir2/exclude.md", "dir2/exclude.txt", "dir2/file", "dir2/UPPER"]],
  [{include: ["**/dir/"]}, []],
  [{include: ["**/dir"]}, ["dir"]],
  [{include: ["**.txt"]}, ["dir2/exclude.txt"]],
  [{include: ["**/dir2/fil?"]}, ["dir2/file"]],
  [{include: ["**/test/**/file"]}, ["dir/file", "dir2/file", "file"]],
  [{include: ["**/u*"], insensitive: true}, ["dir2/UPPER"]],
  [{exclude: ["**/dir2"], include: ["**/file"]}, ["dir/file", "file"]],
] as Array<[RRDirOpts, Array<string>]>) {
  test(`glob ${JSON.stringify(opts)}`, () => makeTest("test", opts, basicExpected.filter(({path}) => names.includes(path.replace("test/", "")))));
}

test("exclude stats", () => makeTest("test", {exclude: ["**/dir", "**/dir2"], stats: true}, (results: Array<Entry>) => {
  expect(results.find(({path}) => path === join(testDir, "test/file"))!.stats!.isFile()).toEqual(true);
}));

test.skipIf(isWindows)("include", () => makeTest("test", {include: [join(testDir, "**/f*")]}, [
  entry("test/dir/file"),
  entry("test/dir2/file"),
  entry("test/file"),
  entry("test/filesymlink", false, true),
]));
test.skipIf(isWindows)("include matches relative dir read from root cwd", () => {
  const cwd = process.cwd();
  process.chdir("/");
  try {
    const dir = relative("/", join(testDir, "test"));
    expect(rrdirSync(dir, {include: [join(testDir, "test/f*")]}).map(e => e.path).sort()).toEqual([`${dir}/file`, `${dir}/filesymlink`]);
  } finally {
    process.chdir(cwd);
  }
});

test("error entry for missing or invalid dir", async () => {
  for (const dir of ["notfound", "not\0found"]) {
    await makeTest(dir, undefined, (results: Array<Entry>) => {
      expect(results.length).toEqual(1);
      expect(results[0].path).toMatch(/not\0?found$/);
      expect(results[0].err).toBeTruthy();
    });
  }
});

test("error strict", async () => {
  await expect(rrdir("notfound", {strict: true}).next()).rejects.toThrow();
  await expect(rrdirAsync("notfound", {strict: true})).rejects.toThrow();
  expect(() => rrdirSync("notfound", {strict: true})).toThrow();
});

test("invalid dir rejects rather than throwing synchronously", async () => {
  await expect(rrdirAsync(null as any)).rejects.toThrow();
});

if (!skipWeird) {
  test("weird as string", () => makeTest("test", {include: ["**/x*"]}, (results: Array<Entry>) => {
    expect(uint8ArrayContains(toUint8Array(results[0].path as string), weirdUint8Array)).toEqual(false);
  }));

  test("weird as Uint8Array", () => makeTest(toUint8Array("test"), {include: ["**/x*"]}, (results: Array<Entry>) => {
    expect(uint8ArrayContains(results[0].path as Uint8Array, weirdUint8Array)).toEqual(true);
  }));
}

test.skipIf(isWindows)("descends into directory whose stat failed", async () => {
  // chmod 0o400 on parent: readdir works, stat on children fails (no traversal bit).
  const dir = mkdtempSync(join(tmpdir(), "rrdir-statfail-"));
  try {
    await mkdir(join(dir, "child"));
    await chmod(dir, 0o400);
    const opts = {stats: true};

    const iter: Array<Entry> = await Array.fromAsync(rrdir(dir, opts));
    const asyncResults = await rrdirAsync(dir, opts);
    const syncResults = rrdirSync(dir, opts);

    for (const results of [iter, asyncResults, syncResults]) {
      expect(results.length).toEqual(2);
      expect(results.every(r => r.err)).toEqual(true);
    }
  } finally {
    await chmod(dir, 0o700);
    await rm(dir, {recursive: true});
  }
});

test.skipIf(isWindows)("stat error yields single entry per path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rrdir-stat-"));
  try {
    await symlink(join(dir, "no-such-target"), join(dir, "broken"));
    const opts = {followSymlinks: true, stats: true};

    const iter: Array<Entry> = await Array.fromAsync(rrdir(dir, opts));
    const asyncResults = await rrdirAsync(dir, opts);
    const syncResults = rrdirSync(dir, opts);

    for (const results of [iter, asyncResults, syncResults]) {
      expect(results.length).toEqual(1);
      expect(results[0].err).toBeTruthy();
      expect(results[0].directory).toBeUndefined();
      expect(results[0].symlink).toBeUndefined();
      expect(results[0].stats).toBeUndefined();
    }
  } finally {
    await rm(dir, {recursive: true});
  }
});

test.skipIf(isWindows)("Uint8Array absolute include", () => makeTest(toUint8Array("test"), {include: [join(testDir, "**/f*")]}, (results: Array<Entry<Uint8Array>>) => {
  const names = results.map(r => toString(r.path)).sort();
  expect(names).toEqual([
    join(testDir, "test/dir/file"),
    join(testDir, "test/dir2/file"),
    join(testDir, "test/file"),
    join(testDir, "test/filesymlink"),
  ].sort());
}));

test("trailing separators stripped", () => {
  const dir = join(testDir, "test");
  for (const convert of [String, toUint8Array]) {
    const read = (suffix: string) => rrdirSync(convert(dir + suffix)).map(({path}) => String(path)).sort();
    for (const suffix of [sep, `${sep}${sep}`, `${sep}${sep}${sep}`, "//"]) expect(read(suffix)).toEqual(read(""));
  }
});

test("root path is read, not corrupted", async () => {
  const root = isWindows ? parse(process.cwd()).root : "/";
  for (const dir of [root, `${root}${sep}`]) {
    const {value, done} = await rrdir(dir).next();
    expect(done).toBe(false);
    expect(value.err).toBeUndefined();
    expect(value.path).not.toBe("");
    expect(value.path.startsWith(root)).toBe(true);
  }
});

test.skipIf(isWindows)("Uint8Array root path is read, not corrupted", async () => {
  const {value, done} = await rrdir(toUint8Array("/")).next();
  expect(done).toBe(false);
  expect(value.err).toBeUndefined();
  expect(toString(value.path).startsWith("/")).toBe(true);
});

test.skipIf(isWindows)("trailing backslash is a filename, not a separator", async () => {
  const dir = join(testDir, "bs");
  await mkdir(join(dir, "a"), {recursive: true});
  await mkdir(join(dir, "a\\"));
  await writeFile(join(dir, "a", "in-a"), "test");
  await writeFile(join(dir, "a\\", "in-backslash"), "test");
  expect(rrdirSync(join(dir, "a\\")).map(e => parse(e.path).base)).toEqual(["in-backslash"]);
  await rm(dir, {recursive: true});
});

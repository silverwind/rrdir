"use strict";

const rrdir = require(".");
const tempy = require("tempy");
const {chdir, cwd: cwdFn} = require("process");
const {join} = require("path");
const {test, expect, beforeAll, afterAll} = global;
const {writeFileSync, unlinkSync, rmdirSync, mkdirSync} = require("fs");

const testDir = tempy.directory();
const cwd = cwdFn();

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
  try { unlinkSync("test/subdir/file") } catch (err) {}
  try { rmdirSync("test/subdir") } catch (err) {}
  try { unlinkSync("test/subdir2/file") } catch (err) {}
  try { rmdirSync("test/subdir2") } catch (err) {}
  try { unlinkSync("test/file") } catch (err) {}
  try { rmdirSync("test") } catch (err) {}
  chdir(cwd);
});

test("basic", async () => {
  const expected = [
    {path: join("test/file"), directory: false, symlink: false},
    {path: join("test/subdir"), directory: true, symlink: false},
    {path: join("test/subdir/file"), directory: false, symlink: false},
    {path: join("test/subdir2"), directory: true, symlink: false},
    {path: join("test/subdir2/file"), directory: false, symlink: false},
  ];

  const streamResults = [];
  for await (const result of rrdir.stream("test")) streamResults.push(result);
  for (const result of [await rrdir("test"), rrdir.sync("test"), streamResults]) {
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  }
});

test("exclude", async () => {
  const opts = {exclude: ["**/subdir"]};
  const expected = [
    {path: join("test/file"), directory: false, symlink: false},
    {path: join("test/subdir2"), directory: true, symlink: false},
    {path: join("test/subdir2/file"), directory: false, symlink: false},
  ];

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  }
});

test("exclude2", async () => {
  const opts = {exclude: ["**/file", "**/subdir2"]};
  const expected = [
    {path: join("test/subdir"), directory: true, symlink: false},
  ];

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  }
});

test("exclude3", async () => {
  const opts = {exclude: ["**/sub*"]};
  const expected = [
    {path: join("test/file"), directory: false, symlink: false},
  ];

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  }
});

test("exclude4", async () => {
  const opts = {exclude: ["**/subdir", "**/subdir2"]};
  const expected = [
    {path: join("test/file"), directory: false, symlink: false},
  ];

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  }
});

test("exclude5", async () => {
  const opts = {exclude: ["**/subdir", "**/subdir2"], stats: true};

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result[0].stats.isFile()).toEqual(true);
  }
});

test("exclude6", async () => {
  const opts = {exclude: ["**"]};

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toEqual([]);
  }
});

test("include", async () => {
  const opts = {include: ["**/f*"]};
  const expected = [
    {path: join("test/file"), directory: false, symlink: false},
    {path: join("test/subdir/file"), directory: false, symlink: false},
    {path: join("test/subdir2/file"), directory: false, symlink: false},
  ];

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  }
});

test("exclude include", async () => {
  const opts = {exclude: ["**/subdir2"], include: ["**/file"]};
  const expected = [
    {path: join("test/file"), directory: false, symlink: false},
    {path: join("test/subdir/file"), directory: false, symlink: false},
  ];

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  }
});

test("notfound strict", async () => {
  await expect(rrdir("notfound", {strict: true})).rejects.toThrow();
  expect(() => rrdir.sync("notfound", {strict: true})).toThrow();
  await expect(rrdir.stream("notfound", {strict: true}).next()).rejects.toThrow();
});

test("notfound", async () => {
  const streamResults = [];
  for await (const result of rrdir.stream("notfound")) streamResults.push(result);

  for (const result of [await rrdir("notfound"), rrdir.sync("notfound"), streamResults]) {
    expect(result.length).toEqual(1);
    expect(result[0].path).toEqual("notfound");
    expect(result[0].err).toBeTruthy();
  }
});

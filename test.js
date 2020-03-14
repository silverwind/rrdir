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
  const streamResults = [];
  for await (const result of rrdir.stream("test")) streamResults.push(result);
  for (const result of [await rrdir("test"), rrdir.sync("test"), streamResults]) {
    expect(result).toEqual([
      {path: join("test/file"), directory: false, symlink: false},
      {path: join("test/subdir"), directory: true, symlink: false},
      {path: join("test/subdir/file"), directory: false, symlink: false},
      {path: join("test/subdir2"), directory: true, symlink: false},
      {path: join("test/subdir2/file"), directory: false, symlink: false},
    ]);
  }
});

test("exclude", async () => {
  const opts = {exclude: ["**/subdir"]};

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toEqual([
      {path: join("test/file"), directory: false, symlink: false},
      {path: join("test/subdir2"), directory: true, symlink: false},
      {path: join("test/subdir2/file"), directory: false, symlink: false},
    ]);
  }
});

test("exclude2", async () => {
  const opts = {exclude: ["**/file", "**/subdir2"]};

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toEqual([
      {path: join("test/subdir"), directory: true, symlink: false},
    ]);
  }
});

test("exclude3", async () => {
  const opts = {exclude: ["**/sub*"]};

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toEqual([
      {path: join("test/file"), directory: false, symlink: false},
    ]);
  }
});

test("exclude4", async () => {
  const opts = {exclude: ["**/subdir", "**/subdir2"]};

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toEqual([
      {path: join("test/file"), directory: false, symlink: false},
    ]);
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

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toEqual([
      {path: join("test/file"), directory: false, symlink: false},
      {path: join("test/subdir"), directory: true, symlink: false},
      {path: join("test/subdir/file"), directory: false, symlink: false},
      {path: join("test/subdir2"), directory: true, symlink: false},
      {path: join("test/subdir2/file"), directory: false, symlink: false},
    ]);
  }
});

test("include2", async () => {
  const opts = {exclude: ["**/subdir2"], include: ["**/file"]};

  const streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    expect(result).toEqual([
      {path: join("test/file"), directory: false, symlink: false},
      {path: join("test/subdir"), directory: true, symlink: false},
      {path: join("test/subdir/file"), directory: false, symlink: false},
    ]);
  }
});

test("notfound", async () => {
  await expect(rrdir("notfound", {strict: true})).rejects.toThrow();
  expect(() => rrdir.sync("notfound", {strict: true})).toThrow();
  await expect(rrdir.stream("notfound", {strict: true}).next()).rejects.toThrow();
});

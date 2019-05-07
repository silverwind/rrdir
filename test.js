"use strict";

const rrdir = require(".");
const assert = require("assert");
const fs = require("fs");

function exit(err) {
  if (err) {
    console.info(err);
  }
  remove();
  process.exit(err ? 1 : 0);
}

function remove() {
  try { fs.unlinkSync("test/subdir/file"); } catch (err) {}
  try { fs.rmdirSync("test/subdir"); } catch (err) {}
  try { fs.unlinkSync("test/subdir2/file"); } catch (err) {}
  try { fs.rmdirSync("test/subdir2"); } catch (err) {}
  try { fs.unlinkSync("test/file"); } catch (err) {}
  try { fs.rmdirSync("test"); } catch (err) {}
}

function create() {
  fs.mkdirSync("test");
  fs.mkdirSync("test/subdir");
  fs.mkdirSync("test/subdir2");
  fs.writeFileSync("test/file");
  fs.writeFileSync("test/subdir/file");
  fs.writeFileSync("test/subdir2/file");
}

async function main() {
  remove();
  create();

  let streamResults, opts;

  /* ---------------------------------------------------------------------- */

  opts = undefined;

  streamResults = [];
  for await (const result of rrdir.stream("test")) streamResults.push(result);

  for (const result of [await rrdir("test"), rrdir.sync("test"), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/file", directory: false, symlink: false},
      {path: "test/subdir", directory: true, symlink: false},
      {path: "test/subdir/file", directory: false, symlink: false},
      {path: "test/subdir2", directory: true, symlink: false},
      {path: "test/subdir2/file", directory: false, symlink: false},
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["subdir"]};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/file", directory: false, symlink: false},
      {path: "test/subdir2", directory: true, symlink: false},
      {path: "test/subdir2/file", directory: false, symlink: false},
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["file", "subdir2"]};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/subdir", directory: true, symlink: false},
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["sub*"]};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/file", directory: false, symlink: false},
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {include: ["f*"]};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/file", directory: false, symlink: false},
      {path: "test/subdir/file", directory: false, symlink: false},
      {path: "test/subdir2/file", directory: false, symlink: false},
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["subdir", "subdir2"]};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/file", directory: false, symlink: false},
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["subdir", "subdir2"], stats: true};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.equal(result[0].stats.isFile(), true);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["subdir2"], include: ["file"]};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/file", directory: false, symlink: false},
      {path: "test/subdir/file", directory: false, symlink: false},
    ]);
  }
}

main().then(exit).catch(exit);

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
  try { fs.unlinkSync("test/subdir/file2"); } catch (err) {}
  try { fs.unlinkSync("test/file1"); } catch (err) {}
  try { fs.rmdirSync("test/subdir"); } catch (err) {}
  try { fs.rmdirSync("test"); } catch (err) {}
}

function create() {
  fs.mkdirSync("test");
  fs.mkdirSync("test/subdir");
  fs.writeFileSync("test/file1");
  fs.writeFileSync("test/subdir/file2");
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
      {path: "test/file1", directory: false, symlink: false},
      {path: "test/subdir", directory: true, symlink: false},
      {path: "test/subdir/file2", directory: false, symlink: false}
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["subdir"]};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.deepStrictEqual(result, [
      {path: "test/file1", directory: false, symlink: false},
    ]);
  }

  /* ---------------------------------------------------------------------- */

  opts = {exclude: ["subdir"], stats: true};

  streamResults = [];
  for await (const result of rrdir.stream("test", opts)) streamResults.push(result);

  for (const result of [await rrdir("test", opts), rrdir.sync("test", opts), streamResults]) {
    assert.equal(result[0].stats.isFile(), true);
  }
}

main().then(exit).catch(exit);

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

  const r1 = [
    await rrdir("test"),
    rrdir.sync("test"),
  ];
  for (const result of r1) {
    assert.deepStrictEqual(result, [
      {path: "test/file1", directory: false, symlink: false},
      {path: "test/subdir", directory: true, symlink: false},
      {path: "test/subdir/file2", directory: false, symlink: false}
    ]);
  }

  const r2 = [
    await rrdir("test", {exclude: ["subdir"]}),
    rrdir.sync("test", {exclude: ["subdir"]}),
  ];
  for (const result of r2) {
    assert.deepStrictEqual(result, [
      {path: "test/file1", directory: false, symlink: false},
    ]);
  }

  const r3 = [
    await rrdir("test", {exclude: ["subdir"], stats: true}),
    rrdir.sync("test", {exclude: ["subdir"], stats: true}),
  ];
  for (const result of r3) {
    assert.equal(result[0].stats.isFile(), true);
  }
}

main().then(exit).catch(exit);

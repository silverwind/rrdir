"use strict";

const rrdir = require(".");
const assert = require("assert");

function exit(err) {
  if (err) {
    console.info(err);
  }
  process.exit(err ? 1 : 0);
}

async function main() {
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

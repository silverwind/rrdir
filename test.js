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
  const results = [
    await rrdir("test"),
    rrdir.sync("test"),
  ];

  for (const result of results) {
    assert.deepStrictEqual(result, [
      {path: "test/file1", directory: false, symlink: false},
      {path: "test/subdir", directory: true, symlink: false},
      {path: "test/subdir/file2", directory: false, symlink: false}
    ]);
  }
}

main().then(exit).catch(exit);

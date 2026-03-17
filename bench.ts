import {rrdir, rrdirAsync, rrdirSync} from "./dist/index.js";
import {mkdtempSync, writeFileSync, mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

const depth = 4;
const breadth = 10;
const filesPerDir = 10;
const iterations = 5;

function createTree(dir: string, currentDepth: number) {
  for (let i = 0; i < filesPerDir; i++) {
    writeFileSync(join(dir, `file${i}.txt`), "x");
  }
  if (currentDepth < depth) {
    for (let i = 0; i < breadth; i++) {
      const sub = join(dir, `dir${i}`);
      mkdirSync(sub);
      createTree(sub, currentDepth + 1);
    }
  }
}

async function bench(label: string, fn: () => unknown | Promise<unknown>) {
  await fn(); // warmup
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  console.info(`${label.padEnd(40)} avg: ${avg.toFixed(1)}ms  min: ${min.toFixed(1)}ms`);
}

const tmpDir = mkdtempSync(join(tmpdir(), "rrdir-bench-"));
const totalFiles = Array.from({length: depth + 1}, (_, d) => breadth ** d * filesPerDir).reduce((a, b) => a + b, 0);
const totalDirs = Array.from({length: depth}, (_, d) => breadth ** (d + 1)).reduce((a, b) => a + b, 0);

console.info(`Creating tree: ${totalFiles} files, ${totalDirs} dirs`);
createTree(tmpDir, 0);

try {
  const {fdir} = await import("fdir");

  console.info("--- async ---");
  await bench("rrdirAsync", () => rrdirAsync(tmpDir));
  await bench("fdir async", () => new fdir().withRelativePaths().withDirs().crawl(tmpDir).withPromise());

  console.info("--- sync ---");
  await bench("rrdirSync", () => rrdirSync(tmpDir));
  await bench("fdir sync", () => new fdir().withRelativePaths().withDirs().crawl(tmpDir).sync());

  console.info("--- async + glob filter (*.txt) ---");
  await bench("rrdirAsync + include", () => rrdirAsync(tmpDir, {include: ["**/*.txt"]}));
  await bench("fdir async + glob", () => new fdir().withRelativePaths().withDirs().glob("**/*.txt").crawl(tmpDir).withPromise());

  console.info("--- sync + glob filter (*.txt) ---");
  await bench("rrdirSync + include", () => rrdirSync(tmpDir, {include: ["**/*.txt"]}));
  await bench("fdir sync + glob", () => new fdir().withRelativePaths().withDirs().glob("**/*.txt").crawl(tmpDir).sync());

  console.info("--- async + exclude (dir0) ---");
  await bench("rrdirAsync + exclude", () => rrdirAsync(tmpDir, {exclude: ["**/dir0/**"]}));
  await bench("fdir async + exclude", () => new fdir().withRelativePaths().withDirs().exclude((_name, dirPath) => dirPath.includes("/dir0")).crawl(tmpDir).withPromise());

  console.info("--- sync + exclude (dir0) ---");
  await bench("rrdirSync + exclude", () => rrdirSync(tmpDir, {exclude: ["**/dir0/**"]}));
  await bench("fdir sync + exclude", () => new fdir().withRelativePaths().withDirs().exclude((_name, dirPath) => dirPath.includes("/dir0")).crawl(tmpDir).sync());

  console.info("--- async iterator ---");
  await bench("rrdir (iterator)", async () => {
    let count = 0;
    for await (const _entry of rrdir(tmpDir)) count += _entry ? 1 : 0;
    return count;
  });
  await bench("rrdir (iterator) + exclude", async () => {
    let count = 0;
    for await (const _entry of rrdir(tmpDir, {exclude: ["**/dir0/**"]})) count += _entry ? 1 : 0;
    return count;
  });

  console.info("--- stats ---");
  await bench("rrdirAsync + stats", () => rrdirAsync(tmpDir, {stats: true}));
  await bench("rrdirSync + stats", () => rrdirSync(tmpDir, {stats: true}));
} finally {
  rmSync(tmpDir, {recursive: true});
}

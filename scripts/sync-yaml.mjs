import { mkdir, readdir, rm, copyFile } from "node:fs/promises";
import path from "node:path";

const mode = process.argv[2];
const root = process.cwd();
const srcRoot = path.join(root, "src", "clis");
const distRoot = path.join(root, "dist", "clis");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      return [fullPath];
    }),
  );
  return files.flat();
}

function isYaml(file) {
  return file.endsWith(".yaml") || file.endsWith(".yml");
}

async function cleanYaml() {
  try {
    const files = (await walk(distRoot)).filter(isYaml);
    await Promise.all(files.map((file) => rm(file, { force: true })));
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
}

async function copyYaml() {
  const files = (await walk(srcRoot)).filter(isYaml);
  await Promise.all(
    files.map(async (file) => {
      const relative = path.relative(path.join(root, "src"), file);
      const target = path.join(root, "dist", relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file, target);
    }),
  );
}

if (mode === "clean") {
  await cleanYaml();
} else if (mode === "copy") {
  await copyYaml();
} else {
  throw new Error(`Unsupported mode: ${mode}`);
}

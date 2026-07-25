import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readUtf8(file: string): Promise<string> {
  return readFile(file, "utf8");
}

export async function writeUtf8IfChanged(file: string, value: string): Promise<boolean> {
  let current: string | undefined;
  try {
    current = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current === value) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value, "utf8");
  return true;
}

export async function writeBinaryIfChanged(file: string, value: Uint8Array): Promise<boolean> {
  let current: Buffer | undefined;
  try {
    current = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current && current.equals(value)) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
  return true;
}

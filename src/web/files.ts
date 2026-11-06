import JSZip from 'jszip';
import type { InputFile } from '../core/schema';

async function fromZip(file: File): Promise<InputFile[]> {
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith('.txt') && !n.includes('__MACOSX') && !zip.files[n].dir);
  return Promise.all(names.map(async (n) => ({ name: n.split('/').pop()!, text: await zip.files[n].async('string') })));
}

export async function readFiles(files: File[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.zip')) out.push(...(await fromZip(f)));
    else if (lower.endsWith('.txt')) out.push({ name: f.name, text: await f.text() });
  }
  return out;
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((res, rej) => entry.file(res, rej));
}

async function walkEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await entryFile(entry as FileSystemFileEntry)];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: FileSystemEntry[] = [];
  // readEntries returns batches, so keep reading until it comes back empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return (await Promise.all(all.map(walkEntry))).flat();
}

/** Handles dropped folders as well as dropped files. */
export async function readDrop(dt: DataTransfer): Promise<InputFile[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return readFiles([...dt.files]);
  return readFiles((await Promise.all(entries.map(walkEntry))).flat());
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

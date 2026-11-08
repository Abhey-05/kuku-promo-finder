
/** Keeps only the files the worker can read. Reading and unzipping happen in the worker. */
export function screenplayFiles(files: File[]): File[] {
  return files.filter((f) => /\.(txt|zip)$/i.test(f.name));
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

/** Handles dropped folders as well as dropped files. Returns File handles only; nothing is read here. */
export async function readDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return screenplayFiles([...dt.files]);
  return screenplayFiles((await Promise.all(entries.map(walkEntry))).flat());
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

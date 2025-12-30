import type { Stats } from "fs";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { Doc } from "@/types";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

export async function loadVaultEntries(rootDir: string): Promise<Doc[]> {
  const resolvedRoot = await fs.realpath(rootDir);
  const visited = new Set<string>([resolvedRoot]);

  async function walk(directory: string): Promise<Doc[]> {
    const dirents = await fs.readdir(directory, { withFileTypes: true });
    const entries: Doc[] = [];

    for (const dirent of dirents) {
      const absolutePath = path.join(directory, dirent.name);

      if (dirent.isSymbolicLink()) {
        const realPath = await fs.realpath(absolutePath);
        if (visited.has(realPath)) continue;
        visited.add(realPath);
        const stats = await fs.stat(realPath);
        if (stats.isDirectory()) {
          entries.push(...(await walk(realPath)));
        } else if (stats.isFile() && isMarkdown(realPath)) {
          entries.push(await createEntry(realPath, resolvedRoot, stats));
        }
        continue;
      }

      if (dirent.isDirectory()) {
        entries.push(...(await walk(absolutePath)));
        continue;
      }

      if (dirent.isFile() && isMarkdown(dirent.name)) {
        entries.push(await createEntry(absolutePath, resolvedRoot));
      }
    }

    return entries;
  }

  return walk(resolvedRoot);
}

function isMarkdown(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function hashString(str: string): string {
  return createHash("sha256").update(str).digest("hex").substring(0, 32);
}

async function createEntry(
  absolutePath: string,
  rootDir: string,
  stats?: Stats
): Promise<Doc> {
  const fileStats = stats ?? (await fs.stat(absolutePath));
  const content = await fs.readFile(absolutePath, "utf-8");
  const relativePath =
    path.relative(rootDir, absolutePath) || path.basename(absolutePath);
  const subject = extractTitle(content) || path.parse(absolutePath).name;

  return {
    id: hashString(relativePath),
    subject,
    content,
    preview: content.substring(0, 100) + "...",
    date: fileStats.mtime.toISOString(),
    from: relativePath,
  };
}

function extractTitle(content: string): string | null {
  const frontmatterTitle = extractFrontmatterTitle(content);
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "").trim() || null;
    }
    break;
  }
  return null;
}

function extractFrontmatterTitle(content: string): string | null {
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatterBody = frontmatterMatch[1];
  const lines = frontmatterBody.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim().toLowerCase();
    if (key !== "title") continue;

    let value = trimmed.slice(colonIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    return value || null;
  }

  return null;
}

import fs from "node:fs/promises";
import wordListPath from "word-list";

let dictionaryCache;

export async function loadDictionary() {
  if (dictionaryCache) {
    return dictionaryCache;
  }

  const rawWords = await fs.readFile(wordListPath, "utf8");
  const words = rawWords
    .split(/\r?\n/)
    .map((word) => word.trim().toUpperCase())
    .filter((word) => /^[A-Z]+$/.test(word));

  dictionaryCache = new Set(words);
  dictionaryCache.add("A");
  dictionaryCache.add("I");
  return dictionaryCache;
}

export class PatchError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "PatchError";
  }
}

export function countOccurrences(source: string, value: string): number {
  if (!value) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(value, offset)) >= 0) {
    count++;
    offset += value.length;
  }
  return count;
}

export function replaceExactlyOnce(
  source: string,
  before: string,
  after: string,
  file: string,
  label: string,
): string {
  if (source.includes(after)) return source;
  const count = countOccurrences(source, before);
  if (count !== 1) {
    throw new PatchError(file, `${label}: expected one semantic anchor, found ${count}`);
  }
  return source.replace(before, after);
}

export function replaceRegexOnce(
  source: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string),
  marker: string,
  file: string,
  label: string,
): string {
  if (source.includes(marker)) return source;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  const matches = [...source.matchAll(globalPattern)];
  if (matches.length !== 1) {
    throw new PatchError(file, `${label}: expected one semantic match, found ${matches.length}`);
  }
  const singlePattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  return source.replace(singlePattern, replacement as never);
}

export function insertBeforeOnce(
  source: string,
  anchor: string,
  addition: string,
  marker: string,
  file: string,
  label: string,
): string {
  if (source.includes(marker)) return source;
  const count = countOccurrences(source, anchor);
  if (count !== 1) {
    throw new PatchError(file, `${label}: expected one semantic anchor, found ${count}`);
  }
  return source.replace(anchor, `${addition}${anchor}`);
}

export function insertAfterOnce(
  source: string,
  anchor: string,
  addition: string,
  marker: string,
  file: string,
  label: string,
): string {
  if (source.includes(marker)) return source;
  const count = countOccurrences(source, anchor);
  if (count !== 1) {
    throw new PatchError(file, `${label}: expected one semantic anchor, found ${count}`);
  }
  return source.replace(anchor, `${anchor}${addition}`);
}

export function addJavaImport(source: string, value: string, file: string): string {
  const statement = `import ${value};`;
  if (source.includes(statement)) return source;
  const imports = [...source.matchAll(/^import\s+[\w.*]+;\r?$/gm)];
  if (imports.length === 0) {
    throw new PatchError(file, "could not find Java import declarations");
  }
  const sorted = imports
    .map((match) => ({ text: match[0], index: match.index }))
    .filter((item): item is { text: string; index: number } => item.index !== undefined);
  const next = sorted.find((item) => item.text.localeCompare(statement) > 0);
  if (next) {
    return `${source.slice(0, next.index)}${statement}\n${source.slice(next.index)}`;
  }
  const last = sorted.at(-1);
  if (!last) throw new PatchError(file, "could not place Java import");
  const end = last.index + last.text.length;
  return `${source.slice(0, end)}\n${statement}${source.slice(end)}`;
}

function findOpeningBrace(source: string, startPattern: RegExp, file: string, label: string): number {
  const flags = startPattern.flags.includes("g") ? startPattern.flags : `${startPattern.flags}g`;
  const pattern = new RegExp(startPattern.source, flags);
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || matches[0]?.index === undefined) {
    throw new PatchError(file, `${label}: expected one declaration, found ${matches.length}`);
  }
  const declarationEnd = matches[0].index + matches[0][0].length;
  const brace = source.indexOf("{", declarationEnd - 1);
  if (brace < 0) throw new PatchError(file, `${label}: declaration has no body`);
  return brace;
}

function matchingBrace(source: string, opening: number, file: string, label: string): number {
  let depth = 0;
  let state: "code" | "line" | "block" | "single" | "double" = "code";
  let escaped = false;
  for (let index = opening; index < source.length; index++) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "line") {
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") {
        state = "code";
        index++;
      }
      continue;
    }
    if (state === "single" || state === "double") {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if ((state === "single" && current === "'") || (state === "double" && current === '"')) state = "code";
      continue;
    }
    if (current === "/" && next === "/") {
      state = "line";
      index++;
    } else if (current === "/" && next === "*") {
      state = "block";
      index++;
    } else if (current === "'") state = "single";
    else if (current === '"') state = "double";
    else if (current === "{") depth++;
    else if (current === "}" && --depth === 0) return index;
  }
  throw new PatchError(file, `${label}: unterminated body`);
}

export function editDeclarationBody(
  source: string,
  startPattern: RegExp,
  file: string,
  label: string,
  edit: (body: string) => string,
): string {
  const opening = findOpeningBrace(source, startPattern, file, label);
  const closing = matchingBrace(source, opening, file, label);
  const body = source.slice(opening + 1, closing);
  const updated = edit(body);
  return updated === body ? source : `${source.slice(0, opening + 1)}${updated}${source.slice(closing)}`;
}

export function isValidRef(ref: string): boolean {
  return /^[A-Z]+-[0-9]+$/.test(ref);
}

export function extractRefFromBranch(branch: string): string | null {
  const match = branch.match(/\/(.+)$/);
  if (!match) return null;
  const ref = match[1];
  return ref.length > 0 ? ref : null;
}

export function parseRefFromTitle(title: string): string | null {
  const match = title.match(/^([A-Z]+-[0-9]+)/);
  return match ? match[1] : null;
}

export interface ParsedCommitMessage {
  title: string;
  body: string;
  ref: string | null;
}

export function parseCommitMessage(message: string): ParsedCommitMessage {
  const lines = message.split('\n');
  const title = lines[0]?.trim() ?? '';
  const body = lines.slice(1).filter((l) => l.trim()).join('\n').trim();
  return { title, body, ref: parseRefFromTitle(title) };
}

export function commitTitleStartsWithRef(title: string, ref: string): boolean {
  return title.startsWith(ref);
}

export function commitTitleContinuesBeyondRef(title: string, ref: string): boolean {
  return title.length > ref.length && title.slice(ref.length).trim().length > 0;
}

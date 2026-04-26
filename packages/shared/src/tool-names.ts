const AGENT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function hashToolName(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function sanitizeAgentToolName(name: string): string {
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  const nonEmpty = sanitized.length > 0 ? sanitized : "tool";
  return nonEmpty.slice(0, 128);
}

export function claimAgentToolName(name: string, used: Set<string>): string {
  const base = sanitizeAgentToolName(name);
  if (AGENT_TOOL_NAME_PATTERN.test(base) && !used.has(base)) {
    used.add(base);
    return base;
  }

  let counter = 0;
  while (true) {
    const suffix = `_${hashToolName(name)}${counter === 0 ? "" : `_${counter}`}`;
    const candidate = `${base.slice(0, 128 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

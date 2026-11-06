import raw from '../../BUILDER.md?raw';

/** BUILDER.md is the one source of the card, so the app and the repo cannot drift apart. */
export const BUILDER_FIELDS: [string, string][] = [...raw.matchAll(/^- \*\*(.+?):\*\* (.+)$/gm)].map((m) => [m[1], m[2]]);

export const builderText = BUILDER_FIELDS.map(([k, v]) => `${k}: ${v}`).join('\n');

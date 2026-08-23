import { VrmlScan, WorldInfoNode } from './vrml-scan';

/**
 * Compares the `WorldInfo` a creator embedded in their object against the record
 * CTR actually holds, so a Mall checker can see agreement or disagreement at a
 * glance instead of reading the WRL in an external editor.
 *
 * Everything here is ADVISORY. No verdict blocks, triggers, or influences any
 * moderation action - accept and reject remain entirely a human decision, and a
 * MISMATCH is a prompt to look, not a reason to refuse.
 */

export type ComparisonVerdict = 'MATCH' | 'MISMATCH' | 'NOT_FOUND' | 'UNPARSED';

export type ComparisonField = 'name' | 'creator' | 'price' | 'limit' | 'store';

export interface FieldComparison {
  field: ComparisonField;
  verdict: ComparisonVerdict;
  /** The full `info[]` entry the value came from, verbatim, or null. */
  worldInfoLine: string | null;
  /** The portion after the recognised prefix, verbatim, or null. */
  worldInfoValue: string | null;
  /** What CTR holds, for side-by-side display. */
  ctrValue: string | number | null;
  /** Present when a verdict needs explaining rather than acting on. */
  note?: string;
}

export interface InterpretedWorldInfo {
  title: string | null;
  creator: string | null;
  price: string | null;
  limit: string | null;
  store: string | null;
  /**
   * Extracted for display only. Deliberately never compared against
   * `object.created_at`: CTR's MySQL/Node timezone configuration is unpinned, so
   * a month/year comparison would be unreliable at month boundaries.
   */
  uploaded: string | null;
}

export interface MallObjectFacts {
  name: string | null;
  creatorUsername: string | null;
  price: number | null;
  limit: number | null;
  storeName: string | null;
}

export interface WorldInfoComparison {
  interpreted: InterpretedWorldInfo;
  comparisons: FieldComparison[];
}

/**
 * Recognised `info[]` prefixes, longest-first within each group so that
 * "Mall Price:" wins over "Price:".
 *
 * These conventions were read off real Mall objects (the "Made By:" family) and
 * off the Vivaty Studio template many creators start from (the "Artist:" /
 * "Price:" / "Limit:" family). Editing this table is the single place to change
 * which conventions CTR recognises.
 */
const PREFIXES: { [key: string]: string[] } = {
  creator: ['made by', 'created by', 'creator', 'artist'],
  price: ['mall price', 'price'],
  limit: ['limited to', 'limit'],
  store: ['store'],
  uploaded: ['uploaded', 'date'],
};

const UNLIMITED_WORDS = ['unlimited', 'none', 'no limit', 'n/a'];

interface PrefixMatch {
  line: string;
  value: string;
}

/**
 * Finds the first `info[]` entry beginning with one of `prefixes`, allowing any
 * surrounding whitespace and any case. The separator colon is optional because
 * real objects are inconsistent about it.
 */
function findPrefixed(info: string[], prefixes: string[]): PrefixMatch | null {
  for (const prefix of prefixes) {
    for (const line of info) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();
      if (lower.indexOf(prefix) !== 0) {
        continue;
      }
      const remainder = trimmed.slice(prefix.length).replace(/^\s*:?\s*/, '');
      return { line, value: remainder };
    }
  }
  return null;
}

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Pulls the first integer out of a value such as "75 CC" or "25 max". */
function parseInteger(value: string): number | null {
  const match = /-?\d+/.exec(value);
  return match ? Number.parseInt(match[0], 10) : null;
}

function compareText(
  field: ComparisonField,
  match: PrefixMatch | null,
  ctrValue: string | null,
): FieldComparison {
  if (!match) {
    return { field, verdict: 'NOT_FOUND', worldInfoLine: null, worldInfoValue: null, ctrValue };
  }
  if (match.value.trim() === '') {
    return {
      field,
      verdict: 'UNPARSED',
      worldInfoLine: match.line,
      worldInfoValue: match.value,
      ctrValue,
      note: 'The entry is present but its value is blank.',
    };
  }
  if (ctrValue === null) {
    return {
      field,
      verdict: 'UNPARSED',
      worldInfoLine: match.line,
      worldInfoValue: match.value,
      ctrValue,
      note: 'CTR holds no value to compare against.',
    };
  }
  return {
    field,
    verdict: normalise(match.value) === normalise(ctrValue) ? 'MATCH' : 'MISMATCH',
    worldInfoLine: match.line,
    worldInfoValue: match.value,
    ctrValue,
  };
}

function comparePrice(match: PrefixMatch | null, ctrPrice: number | null): FieldComparison {
  if (!match) {
    return {
      field: 'price',
      verdict: 'NOT_FOUND',
      worldInfoLine: null,
      worldInfoValue: null,
      ctrValue: ctrPrice,
    };
  }
  const parsed = parseInteger(match.value);
  if (parsed === null) {
    return {
      field: 'price',
      verdict: 'UNPARSED',
      worldInfoLine: match.line,
      worldInfoValue: match.value,
      ctrValue: ctrPrice,
      note: match.value.trim() === ''
        ? 'The entry is present but its value is blank.'
        : 'No number could be read from the entry.',
    };
  }
  return {
    field: 'price',
    verdict: parsed === ctrPrice ? 'MATCH' : 'MISMATCH',
    worldInfoLine: match.line,
    worldInfoValue: match.value,
    ctrValue: ctrPrice,
  };
}

/**
 * Limit needs its own comparison because CTR's own `limit = 0` semantics are
 * unresolved: the Update Limit prompt says "0 makes it Unlimited", but the
 * Out-of-Stock view only treats NULL that way. Rather than pick a side, a stored
 * 0 is reported as UNPARSED with an explanation.
 */
function compareLimit(match: PrefixMatch | null, ctrLimit: number | null): FieldComparison {
  const ctrValue = ctrLimit;

  if (!match) {
    return {
      field: 'limit',
      verdict: 'NOT_FOUND',
      worldInfoLine: null,
      worldInfoValue: null,
      ctrValue,
    };
  }

  if (ctrLimit === 0) {
    return {
      field: 'limit',
      verdict: 'UNPARSED',
      worldInfoLine: match.line,
      worldInfoValue: match.value,
      ctrValue,
      note: 'CTR stores limit = 0, whose meaning is unresolved (the Update Limit prompt '
        + 'calls it unlimited, the Out of Stock view does not). Not compared.',
    };
  }

  const value = match.value.trim();
  if (value === '') {
    return {
      field: 'limit',
      verdict: 'UNPARSED',
      worldInfoLine: match.line,
      worldInfoValue: match.value,
      ctrValue,
      note: 'The entry is present but its value is blank.',
    };
  }

  const saysUnlimited = UNLIMITED_WORDS.indexOf(normalise(value)) !== -1;
  if (saysUnlimited) {
    return {
      field: 'limit',
      verdict: ctrLimit === null ? 'MATCH' : 'MISMATCH',
      worldInfoLine: match.line,
      worldInfoValue: match.value,
      ctrValue,
    };
  }

  const parsed = parseInteger(value);
  if (parsed === null) {
    return {
      field: 'limit',
      verdict: 'UNPARSED',
      worldInfoLine: match.line,
      worldInfoValue: match.value,
      ctrValue,
      note: 'No number and no "unlimited" wording could be read from the entry.',
    };
  }

  return {
    field: 'limit',
    verdict: parsed === ctrLimit ? 'MATCH' : 'MISMATCH',
    worldInfoLine: match.line,
    worldInfoValue: match.value,
    ctrValue,
  };
}

function compareTitle(title: string | null, ctrName: string | null): FieldComparison {
  if (title === null) {
    return {
      field: 'name',
      verdict: 'NOT_FOUND',
      worldInfoLine: null,
      worldInfoValue: null,
      ctrValue: ctrName,
    };
  }
  if (ctrName === null) {
    return {
      field: 'name',
      verdict: 'UNPARSED',
      worldInfoLine: title,
      worldInfoValue: title,
      ctrValue: null,
      note: 'CTR holds no value to compare against.',
    };
  }
  return {
    field: 'name',
    verdict: normalise(title) === normalise(ctrName) ? 'MATCH' : 'MISMATCH',
    worldInfoLine: title,
    worldInfoValue: title,
    ctrValue: ctrName,
  };
}

/**
 * Uses the FIRST WorldInfo node when an object contains more than one. The
 * `multiple_worldinfo` finding from the scanner tells the checker to say so.
 */
export function compareWorldInfo(scan: VrmlScan, facts: MallObjectFacts): WorldInfoComparison {
  const node: WorldInfoNode = scan.worldInfo[0] || { title: null, info: [] };
  const info = node.info;

  const creator = findPrefixed(info, PREFIXES.creator);
  const price = findPrefixed(info, PREFIXES.price);
  const limit = findPrefixed(info, PREFIXES.limit);
  const store = findPrefixed(info, PREFIXES.store);
  const uploaded = findPrefixed(info, PREFIXES.uploaded);

  return {
    interpreted: {
      title: node.title,
      creator: creator ? creator.value : null,
      price: price ? price.value : null,
      limit: limit ? limit.value : null,
      store: store ? store.value : null,
      uploaded: uploaded ? uploaded.value : null,
    },
    comparisons: [
      compareTitle(node.title, facts.name),
      compareText('creator', creator, facts.creatorUsername),
      comparePrice(price, facts.price),
      compareLimit(limit, facts.limit),
      compareText('store', store, facts.storeName),
    ],
  };
}

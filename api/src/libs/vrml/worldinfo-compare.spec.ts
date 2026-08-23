import { scanVrml } from './vrml-scan';
import {
  ComparisonField,
  ComparisonVerdict,
  compareWorldInfo,
  MallObjectFacts,
} from './worldinfo-compare';

const HEADER = '#VRML V2.0 utf8';

function scanOf(info: string[], title = 'Pocket Moon Playset') {
  const entries = info.map(line => `    "${line}"`).join('\n');
  return scanVrml(`${HEADER}\nWorldInfo {\n  title "${title}"\n  info [\n${entries}\n  ]\n}\n`);
}

const FACTS: MallObjectFacts = {
  name: 'Pocket Moon Playset',
  creatorUsername: 'BassMekanik',
  price: 75,
  limit: null,
  storeName: 'Toy Store',
};

function verdictFor(comparisons: { field: ComparisonField; verdict: ComparisonVerdict }[],
  field: ComparisonField): ComparisonVerdict {
  const found = comparisons.find(comparison => comparison.field === field);
  return found ? found.verdict : ('NOT_FOUND' as ComparisonVerdict);
}

describe('compareWorldInfo - the real production object', () => {
  it('matches every field of Pocket Moon Playset', () => {
    const scan = scanOf([
      'Made By: BassMekanik',
      'Uploaded: August, 2026',
      'Store: Toy Store',
      'Limited To: UNLIMITED',
      'Mall Price: 75 CC',
      'Collection: No. 1 of 5',
    ]);

    const { comparisons, interpreted } = compareWorldInfo(scan, FACTS);

    expect(verdictFor(comparisons, 'name')).toBe('MATCH');
    expect(verdictFor(comparisons, 'creator')).toBe('MATCH');
    expect(verdictFor(comparisons, 'price')).toBe('MATCH');
    expect(verdictFor(comparisons, 'limit')).toBe('MATCH');
    expect(verdictFor(comparisons, 'store')).toBe('MATCH');
    expect(interpreted.uploaded).toBe('August, 2026');
  });
});

describe('compareWorldInfo - verdicts', () => {
  it('reports MISMATCH on a differing creator', () => {
    const scan = scanOf(['Made By: SomeoneElse']);

    expect(verdictFor(compareWorldInfo(scan, FACTS).comparisons, 'creator')).toBe('MISMATCH');
  });

  it('reads a price out of "75 CC" and matches it', () => {
    expect(verdictFor(compareWorldInfo(scanOf(['Mall Price: 75 CC']), FACTS).comparisons, 'price'))
      .toBe('MATCH');
  });

  it('reports MISMATCH on a differing price', () => {
    expect(verdictFor(compareWorldInfo(scanOf(['Mall Price: 90 CC']), FACTS).comparisons, 'price'))
      .toBe('MISMATCH');
  });

  it('treats UNLIMITED wording as matching a NULL limit', () => {
    ['UNLIMITED', 'unlimited', 'None', 'no limit'].forEach(word => {
      expect(verdictFor(compareWorldInfo(scanOf([`Limited To: ${word}`]), FACTS).comparisons,
        'limit')).toBe('MATCH');
    });
  });

  it('reports MISMATCH when WorldInfo says a number but CTR holds no limit', () => {
    expect(verdictFor(compareWorldInfo(scanOf(['Limited To: 25']), FACTS).comparisons, 'limit'))
      .toBe('MISMATCH');
  });

  it('reports MISMATCH when WorldInfo says UNLIMITED but CTR holds a number', () => {
    const facts = { ...FACTS, limit: 40 };

    expect(verdictFor(compareWorldInfo(scanOf(['Limited To: UNLIMITED']), facts).comparisons,
      'limit')).toBe('MISMATCH');
  });

  it('matches a numeric limit against the stored limit', () => {
    const facts = { ...FACTS, limit: 40 };

    expect(verdictFor(compareWorldInfo(scanOf(['Limited To: 40']), facts).comparisons, 'limit'))
      .toBe('MATCH');
  });

  it('reports NOT_FOUND when a field has no recognised entry', () => {
    const scan = scanOf(['(c) August 2026 by Morning.star', 'A nice object']);
    const { comparisons } = compareWorldInfo(scan, FACTS);

    expect(verdictFor(comparisons, 'creator')).toBe('NOT_FOUND');
    expect(verdictFor(comparisons, 'price')).toBe('NOT_FOUND');
    expect(verdictFor(comparisons, 'store')).toBe('NOT_FOUND');
  });

  it('reports NOT_FOUND for the name when the object has no WorldInfo at all', () => {
    const scan = scanVrml(`${HEADER}\nShape {}\n`);

    expect(verdictFor(compareWorldInfo(scan, FACTS).comparisons, 'name')).toBe('NOT_FOUND');
  });
});

describe('compareWorldInfo - the Vivaty template creators leave blank', () => {
  // Object 3341 on production is stocked with exactly this unfilled template.
  it('reports UNPARSED rather than MISMATCH for blank template values', () => {
    const scan = scanOf(
      ['This Web3D Content was created with Vivaty Studio', 'Price:', 'Limit:', 'Artist:', 'Date:'],
      'Title',
    );
    const { comparisons } = compareWorldInfo(scan, FACTS);

    expect(verdictFor(comparisons, 'price')).toBe('UNPARSED');
    expect(verdictFor(comparisons, 'limit')).toBe('UNPARSED');
    expect(verdictFor(comparisons, 'creator')).toBe('UNPARSED');
    // The title genuinely differs, so that one is a real mismatch.
    expect(verdictFor(comparisons, 'name')).toBe('MISMATCH');
  });
});

describe('compareWorldInfo - prefix handling', () => {
  it('prefers the longer "Mall Price" over "Price"', () => {
    const scan = scanOf(['Price: 10', 'Mall Price: 75 CC']);
    const { interpreted } = compareWorldInfo(scan, FACTS);

    expect(interpreted.price).toBe('75 CC');
  });

  it('prefers the longer "Limited To" over "Limit"', () => {
    const scan = scanOf(['Limit: 10', 'Limited To: UNLIMITED']);

    expect(compareWorldInfo(scan, FACTS).interpreted.limit).toBe('UNLIMITED');
  });

  it('is case-insensitive and tolerant of spacing around the colon', () => {
    const scan = scanOf(['  MADE BY   :   BassMekanik  ']);

    expect(verdictFor(compareWorldInfo(scan, FACTS).comparisons, 'creator')).toBe('MATCH');
  });

  it('accepts the Vivaty "Artist:" convention for the creator', () => {
    expect(verdictFor(compareWorldInfo(scanOf(['Artist: BassMekanik']), FACTS).comparisons,
      'creator')).toBe('MATCH');
  });
});

describe('compareWorldInfo - unresolved CTR semantics', () => {
  it('refuses to compare a stored limit of 0 and explains why', () => {
    const facts = { ...FACTS, limit: 0 };
    const comparison = compareWorldInfo(scanOf(['Limited To: UNLIMITED']), facts)
      .comparisons.find(entry => entry.field === 'limit');

    expect(comparison.verdict).toBe('UNPARSED');
    expect(comparison.note).toContain('unresolved');
  });

  it('never compares the uploaded date, only extracts it', () => {
    const { interpreted, comparisons } = compareWorldInfo(scanOf(['Uploaded: August, 2026']),
      FACTS);

    expect(interpreted.uploaded).toBe('August, 2026');
    expect(comparisons.map(entry => entry.field)).not.toContain('uploaded');
  });
});

describe('compareWorldInfo - deleted creators', () => {
  it('reports UNPARSED, never a mismatch, when CTR has no creator', () => {
    const facts = { ...FACTS, creatorUsername: null };
    const comparison = compareWorldInfo(scanOf(['Made By: BassMekanik']), facts)
      .comparisons.find(entry => entry.field === 'creator');

    expect(comparison.verdict).toBe('UNPARSED');
    expect(comparison.ctrValue).toBeNull();
  });
});

describe('compareWorldInfo - multiple WorldInfo nodes', () => {
  it('uses the first node, leaving the scanner to flag that there are several', () => {
    const scan = scanVrml(
      `${HEADER}\nWorldInfo { title "First" }\nWorldInfo { title "Second" }\n`,
    );
    const facts = { ...FACTS, name: 'First' };

    expect(verdictFor(compareWorldInfo(scan, facts).comparisons, 'name')).toBe('MATCH');
    expect(scan.warnings).toContain('multiple_worldinfo');
  });
});

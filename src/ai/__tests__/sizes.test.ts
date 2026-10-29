import { describe, expect, it } from 'vitest';
import {
  editableSizesFromDraft,
  effectiveDraftSizes,
  normalizeDraftSizes,
  primarySize,
  sizeRowsIssue,
  sizeRowsToDraftSizes,
  totalSizeQuantity,
} from '../sizes';

describe('editableSizesFromDraft', () => {
  it('prefers persisted size rows', () => {
    expect(
      editableSizesFromDraft({
        sizes: [
          { size: 'M', quantity: 2 },
          { size: 'L', quantity: 3 },
        ],
        size: 'M',
        quantity: 5,
      })
    ).toEqual([
      { size: 'M', qty: '2' },
      { size: 'L', qty: '3' },
    ]);
  });

  it('falls back to the single size and quantity on older drafts', () => {
    expect(
      editableSizesFromDraft({ sizes: [], size: 'XL', quantity: 4 })
    ).toEqual([{ size: 'XL', qty: '4' }]);
  });
});

describe('sizeRowsToDraftSizes', () => {
  it('drops incomplete rows and merges duplicate sizes', () => {
    expect(
      sizeRowsToDraftSizes([
        { size: ' M ', qty: '2' },
        { size: 'm', qty: '3' },
        { size: '', qty: '9' },
        { size: 'L', qty: '0' },
        { size: 'XL', qty: '1' },
      ])
    ).toEqual([
      { size: 'M', quantity: 5 },
      { size: 'XL', quantity: 1 },
    ]);
  });
});

describe('sizeRowsIssue', () => {
  it('requires at least one size when stock is being received', () => {
    expect(sizeRowsIssue([], true)).toBe('quantity');
    expect(sizeRowsIssue([], false)).toBeNull();
  });

  it('reports a missing size or invalid quantity', () => {
    expect(sizeRowsIssue([{ size: '', qty: '2' }], true)).toBe('size');
    expect(sizeRowsIssue([{ size: 'M', qty: '0' }], true)).toBe('quantity');
    expect(sizeRowsIssue([{ size: 'M', qty: '-1' }], true)).toBe('quantity');
    expect(
      sizeRowsIssue(
        [
          { size: 'M', qty: '0' },
          { size: 'L', qty: '2' },
        ],
        true
      )
    ).toBeNull();
    expect(sizeRowsIssue([{ size: 'M', qty: '2' }], true)).toBeNull();
  });
});

describe('size totals', () => {
  it('normalises and sums stock entries', () => {
    const sizes = normalizeDraftSizes([
      { size: 'S', quantity: 1 },
      { size: 's', quantity: 2 },
      { size: 'M', quantity: 4 },
    ]);
    expect(totalSizeQuantity(sizes)).toBe(7);
    expect(primarySize(sizes)).toBe('S');
  });

  it('uses explicit review rows before persisted draft rows', () => {
    expect(
      effectiveDraftSizes(
        { sizes: [{ size: 'M', quantity: 2 }], size: 'M', quantity: 2 },
        [{ size: 'L', quantity: 3 }]
      )
    ).toEqual([{ size: 'L', quantity: 3 }]);
  });
});

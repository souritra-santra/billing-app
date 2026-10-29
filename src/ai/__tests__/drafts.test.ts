import { describe, expect, it } from 'vitest';
import {
  findDuplicateProduct,
  matchProductType,
  normalizeText,
  validateDraftForCreate,
  validateDraftForStock,
} from '../drafts';

const TYPES = [
  { id: 'pt-shirt', name: 'Shirt' },
  { id: 'pt-tshirt', name: 'T-Shirt' },
  { id: 'pt-jeans', name: 'Jeans' },
  { id: 'pt-trousers', name: 'Trousers' },
];

describe('normalizeText', () => {
  it('normalises case, punctuation and spacing', () => {
    expect(normalizeText('  Levi’s  & Co. ')).toBe('levi s and co');
  });
});

describe('matchProductType', () => {
  it('matches exact product type names', () => {
    expect(matchProductType('Shirt', TYPES)).toBe('pt-shirt');
    expect(matchProductType('jeans', TYPES)).toBe('pt-jeans');
  });

  it('prefers the closest match for T-Shirt', () => {
    expect(matchProductType('T-Shirt', TYPES)).toBe('pt-tshirt');
  });

  it('matches inflected labels such as Trouser -> Trousers', () => {
    expect(matchProductType('Trouser', TYPES)).toBe('pt-trousers');
  });

  it('returns null when the hint is unknown', () => {
    expect(matchProductType('Kurti', TYPES)).toBeNull();
    expect(matchProductType(null, TYPES)).toBeNull();
    expect(matchProductType('', TYPES)).toBeNull();
  });
});

describe('findDuplicateProduct', () => {
  const products = [
    {
      id: 'p1',
      name: 'Blue Denim Shirt',
      barcode: '8901234567890',
      type_id: 'pt-shirt',
      price: 1299,
    },
    {
      id: 'p2',
      name: 'Cotton Kurta',
      barcode: 'BC-ABC',
      type_id: 'pt-other',
      price: 799,
    },
  ];

  it('detects a barcode match first', () => {
    const match = findDuplicateProduct(
      { name: 'Different name', brand: null, barcode: '8901234567890' },
      products
    );
    expect(match?.reason).toBe('barcode');
    expect(match?.product.id).toBe('p1');
  });

  it('detects a name match when the barcode is absent', () => {
    const match = findDuplicateProduct(
      { name: 'blue denim shirt', brand: null, barcode: null },
      products
    );
    expect(match?.reason).toBe('name');
    expect(match?.product.id).toBe('p1');
  });

  it('detects brand + name combinations', () => {
    const match = findDuplicateProduct(
      { name: 'Denim Shirt', brand: 'Blue', barcode: null },
      products
    );
    expect(match?.product.id).toBe('p1');
  });

  it('does not flag unrelated products', () => {
    expect(
      findDuplicateProduct(
        { name: 'Silk Saree', brand: 'FabIndia', barcode: null },
        products
      )
    ).toBeNull();
  });
});

describe('draft validation', () => {
  it('requires name, type and price for creation', () => {
    expect(
      validateDraftForCreate({ name: null, type_id: null, mrp: null }, false)
    ).toEqual(['name', 'type', 'price']);
  });

  it('requires quantity and size when stock is received', () => {
    expect(
      validateDraftForCreate(
        { name: 'Shirt', type_id: 'pt-shirt', mrp: 499 },
        true
      )
    ).toEqual(['quantity', 'size']);

    expect(
      validateDraftForCreate(
        { name: 'Shirt', type_id: 'pt-shirt', mrp: 499, quantity: 2 },
        true
      )
    ).toEqual(['size']);

    expect(
      validateDraftForCreate(
        { name: 'Shirt', type_id: 'pt-shirt', mrp: 499, quantity: 2, size: 'M' },
        true
      )
    ).toEqual([]);
  });

  it('passes a complete create draft', () => {
    expect(
      validateDraftForCreate(
        { name: 'Shirt', type_id: 'pt-shirt', mrp: 499 },
        false
      )
    ).toEqual([]);
  });

  it('requires quantity and size for stock receipt', () => {
    expect(validateDraftForStock({ quantity: 2, size: 'M' })).toEqual([]);
    expect(validateDraftForStock({ quantity: null, size: null })).toEqual([
      'quantity',
      'size',
    ]);
    expect(validateDraftForStock({ quantity: 2, size: '  ' })).toEqual(['size']);
  });
});

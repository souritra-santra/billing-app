import { describe, expect, it } from 'vitest';
import {
  AiResultValidationError,
  parseAiExtraction,
  parseConfidence,
  parseLooseJson,
  parseMoney,
  parseQuantity,
} from '../parse';

describe('parseMoney', () => {
  it('parses numbers and common currency formats', () => {
    expect(parseMoney(1299)).toBe(1299);
    expect(parseMoney('₹1,299.50')).toBe(1299.5);
    expect(parseMoney('Rs. 499')).toBe(499);
    expect(parseMoney('1299/-')).toBe(1299);
  });

  it('returns null for missing or invalid values instead of guessing', () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
    expect(parseMoney(-10)).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('parses positive whole quantities', () => {
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity('2 pcs')).toBe(2);
    expect(parseQuantity('10')).toBe(10);
  });

  it('rejects zero, negative and unreadable quantities', () => {
    expect(parseQuantity(0)).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
    expect(parseQuantity('many')).toBeNull();
  });
});

describe('parseConfidence', () => {
  it('normalises percentages and clamps to 0..1', () => {
    expect(parseConfidence(0.82)).toBe(0.82);
    expect(parseConfidence('90%')).toBe(0.9);
    expect(parseConfidence(82)).toBe(0.82);
    expect(parseConfidence(1.5)).toBe(1);
  });
});

describe('parseLooseJson', () => {
  it('accepts fenced JSON', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts JSON surrounded by prose', () => {
    expect(parseLooseJson('Here is the result: {"a":1} thanks')).toEqual({ a: 1 });
  });

  it('throws a validation error for non-JSON text', () => {
    expect(() => parseLooseJson('not json')).toThrow(AiResultValidationError);
  });
});

describe('parseAiExtraction', () => {
  const valid = {
    document_type: 'purchase_invoice',
    supplier_name: 'Acme Textiles',
    invoice_number: 'INV-42',
    invoice_date: '2026-10-29',
    image_quality: 'good',
    warnings: [],
    products: [
      {
        name: 'Blue Denim Shirt',
        brand: 'Levis',
        purchase_cost: '₹850',
        mrp: '1,299',
        quantity: '2 pcs',
        size: 'M',
        colour: 'Blue',
        barcode: '8901234567890',
        product_type_hint: 'Shirt',
        confidence: '92%',
      },
      {
        name: 'Cotton Tee',
        brand: null,
        purchase_cost: null,
        mrp: null,
        quantity: null,
        size: null,
        colour: null,
        barcode: null,
        product_type_hint: null,
        confidence: null,
      },
    ],
  };

  it('validates and normalises structured output', () => {
    const result = parseAiExtraction(valid);

    expect(result.products).toHaveLength(2);
    expect(result.products[0]).toMatchObject({
      name: 'Blue Denim Shirt',
      brand: 'Levis',
      purchase_cost: 850,
      mrp: 1299,
      quantity: 2,
      size: 'M',
      colour: 'Blue',
      confidence: 0.92,
    });
    expect(result.products[1]).toMatchObject({
      brand: null,
      purchase_cost: null,
      mrp: null,
      quantity: null,
      size: null,
      colour: null,
      barcode: null,
      confidence: null,
    });
  });

  it('keeps missing product fields null instead of inventing values', () => {
    const result = parseAiExtraction({
      ...valid,
      products: [{ name: 'Plain Kurta' }],
    });
    expect(result.products[0]).toEqual({
      name: 'Plain Kurta',
      brand: null,
      purchase_cost: null,
      mrp: null,
      quantity: null,
      size: null,
      colour: null,
      barcode: null,
      product_type_hint: null,
      confidence: null,
    });
  });

  it('rejects a response without a products array', () => {
    expect(() => parseAiExtraction({ document_type: 'unknown' })).toThrow(
      AiResultValidationError
    );
  });

  it('adds a retake warning for blurry images', () => {
    const result = parseAiExtraction({
      ...valid,
      image_quality: 'blurry',
      products: [],
    });
    expect(result.image_quality).toBe('blurry');
    expect(result.warnings.join(' ')).toMatch(/blurry/i);
    expect(result.warnings.join(' ')).toMatch(/no products/i);
  });

  it('accepts a JSON string from the proxy', () => {
    expect(parseAiExtraction(JSON.stringify(valid)).supplier_name).toBe(
      'Acme Textiles'
    );
  });
});

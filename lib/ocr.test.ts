import { describe, expect, it } from 'vitest';
import { extractSuggestedTransactionFromFile, parseNumericAmount } from './ocr';

describe('extractSuggestedTransactionFromFile', () => {
  it('detects Amazon purchase patterns and suggests a cost category', () => {
    const result = extractSuggestedTransactionFromFile('amazon-receipt.jpg');

    expect(result.vendorName).toBe('Amazon');
    expect(result.category).toBe('消耗品費');
    expect(result.amount).toBeGreaterThan(0);
    expect(result.sourceType).toBe('receipt');
  });

  it('detects a card statement and allows a custom product name', () => {
    const result = extractSuggestedTransactionFromFile('card-statement-2026-09.jpg');

    expect(result.sourceType).toBe('card_statement');
    expect(result.category).toBe('消耗品費');
    expect(result.productName).toBe('カード明細');
    expect(result.amount).toBeGreaterThan(0);
  });

  it('detects a daily report and extracts the expected sales breakdown', () => {
    const result = extractSuggestedTransactionFromFile('daily-report-2026-09-09.jpg');

    expect(result.vendorName).toBe('券売機日計表');
    expect(result.sourceType).toBe('daily_report');
    expect(result.breakdown?.adult.count).toBe(12);
    expect(result.breakdown?.adult.unitPrice).toBe(1800);
    expect(result.breakdown?.junior.count).toBe(5);
    expect(result.breakdown?.child.count).toBe(3);
    expect(result.breakdown?.monk.count).toBe(2);
  });

  it('reads numeric amounts from OCR-like text', () => {
    expect(parseNumericAmount('合計 4,200 円')).toBe(4200);
    expect(parseNumericAmount('￥32,500')).toBe(32500);
  });

  it('extracts a daily report from OCR text and preserves the salon breakdown', () => {
    const result = extractSuggestedTransactionFromFile('upload.jpg', `
      日計表
      大人 12人 21,600円
      中高生 5人 7,500円
      小学生以下 3人 3,600円
      坊主 2人 3,000円
      合計 35,700円
    `);

    expect(result.sourceType).toBe('daily_report');
    expect(result.breakdown?.adult.count).toBe(12);
    expect(result.breakdown?.junior.count).toBe(5);
    expect(result.breakdown?.child.count).toBe(3);
    expect(result.breakdown?.monk.count).toBe(2);
    expect(result.amount).toBe(35700);
  });

  it('extracts a receipt expense from OCR text and classifies the cost properly', () => {
    const result = extractSuggestedTransactionFromFile('receipt-2026-09-09.jpg', `
      Amazon
      Hair care products
      合計 1,800円
      2026/09/09
    `);

    expect(result.sourceType).toBe('receipt');
    expect(result.vendorName).toBe('Amazon');
    expect(result.category).toBe('消耗品費');
    expect(result.amount).toBe(1800);
  });

  it('extracts breakdown from OCR text that uses 中高校生 label', () => {
    const result = extractSuggestedTransactionFromFile('upload.jpg', `
      日計表 大人12人21600円 中高校生5人7500円 小学生以下3人3600円 坊主2人3000円 合計35700円
    `);

    expect(result.sourceType).toBe('daily_report');
    expect(result.breakdown?.adult.count).toBe(12);
    expect(result.breakdown?.junior.count).toBe(5);
    expect(result.breakdown?.child.count).toBe(3);
    expect(result.breakdown?.monk.count).toBe(2);
    expect(result.amount).toBe(35700);
  });

  it('extracts daily report from ticket-count-only OCR text', () => {
    const result = extractSuggestedTransactionFromFile('camera-upload.jpg', `
      チケット日計
      大人券12枚
      中高生券5枚
      小人券3枚
      坊主券2枚
    `);

    expect(result.sourceType).toBe('daily_report');
    expect(result.breakdown?.adult.count).toBe(12);
    expect(result.breakdown?.junior.count).toBe(5);
    expect(result.breakdown?.child.count).toBe(3);
    expect(result.breakdown?.monk.count).toBe(2);
    expect(result.amount).toBe(35700);
  });
});

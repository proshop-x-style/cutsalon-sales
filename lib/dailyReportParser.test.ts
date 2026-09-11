import { describe, expect, it } from 'vitest';
import { calculateBreakdownTotal, parseDailyReportText } from './dailyReportParser';

describe('parseDailyReportText', () => {
  it('parses the daily report sales summary and pricing breakdown', () => {
    const text = `
      大人 12人 21600円
      中高生 5人 7500円
      小学生以下 3人 3600円
      坊主 2人 3000円
      合計 35700円
    `;

    const result = parseDailyReportText(text);

    expect(result.totalSales).toBe(35700);
    expect(result.totalCustomers).toBe(22);
    expect(result.breakdown.adult.count).toBe(12);
    expect(result.breakdown.junior.count).toBe(5);
    expect(result.breakdown.child.count).toBe(3);
    expect(result.breakdown.monk.count).toBe(2);
  });

  it('calculates the correct total when counts are adjusted', () => {
    const total = calculateBreakdownTotal({
      adult: { count: 12, unitPrice: 1800, amount: 21600 },
      junior: { count: 5, unitPrice: 1500, amount: 7500 },
      child: { count: 3, unitPrice: 1200, amount: 3600 },
      monk: { count: 2, unitPrice: 1500, amount: 3000 },
    });

    expect(total).toBe(35700);
  });

  it('parses OCR text with label variations and no explicit 人 suffix', () => {
    const text = `
      日計表
      大人 12 21600円
      中高校生 5 7500円
      小学生以下 3 3600円
      坊主 2 3000円
    `;

    const result = parseDailyReportText(text);

    expect(result.breakdown.adult.count).toBe(12);
    expect(result.breakdown.junior.count).toBe(5);
    expect(result.breakdown.child.count).toBe(3);
    expect(result.breakdown.monk.count).toBe(2);
    expect(result.totalSales).toBe(35700);
  });

  it('parses single-line OCR text where all categories are merged', () => {
    const text = '日計表 大人12人21600円 中高校生5人7500円 小学生以下3人3600円 坊主2人3000円 合計35700円';

    const result = parseDailyReportText(text);

    expect(result.breakdown.adult.count).toBe(12);
    expect(result.breakdown.junior.count).toBe(5);
    expect(result.breakdown.child.count).toBe(3);
    expect(result.breakdown.monk.count).toBe(2);
    expect(result.totalSales).toBe(35700);
  });

  it('parses ticket-count format and treats ticket counts as customer counts', () => {
    const text = `
      日計表
      大人券 12枚
      中高生券 5枚
      小人券 3枚
      坊主券 2枚
    `;

    const result = parseDailyReportText(text);

    expect(result.breakdown.adult.count).toBe(12);
    expect(result.breakdown.junior.count).toBe(5);
    expect(result.breakdown.child.count).toBe(3);
    expect(result.breakdown.monk.count).toBe(2);
    expect(result.totalSales).toBe(35700);
  });

  it('falls back to ordered count inference when labels are noisy', () => {
    const text = `
      日計表
      A区分 12枚 21600円
      B区分 5枚 7500円
      C区分 3枚 3600円
      D区分 2枚 3000円
    `;

    const result = parseDailyReportText(text);

    expect(result.breakdown.adult.count).toBe(12);
    expect(result.breakdown.junior.count).toBe(5);
    expect(result.breakdown.child.count).toBe(3);
    expect(result.breakdown.monk.count).toBe(2);
    expect(result.totalSales).toBe(35700);
  });

  it('parses ticket print where counts are shown next to unit prices', () => {
    const text = `
      日計表
      1800円 5枚 9000円
      1500円 高生 3枚 4500円
      1200円 学生以下 2枚 2400円
      1500円 坊主 1枚 1500円
      売上 11枚 17400円
    `;

    const result = parseDailyReportText(text);

    expect(result.breakdown.adult.count).toBe(5);
    expect(result.breakdown.junior.count).toBe(3);
    expect(result.breakdown.child.count).toBe(2);
    expect(result.breakdown.monk.count).toBe(1);
    expect(result.totalSales).toBe(17400);
  });

  it('derives counts from unit-price and amount when count label is unreadable', () => {
    const text = `
      日計表
      1800円 *** 9000円
      1500円 高生 *** 4500円
      1200円 学生以下 *** 2400円
      1500円 坊主 *** 1500円
    `;

    const result = parseDailyReportText(text);

    expect(result.breakdown.adult.count).toBe(5);
    expect(result.breakdown.junior.count).toBe(3);
    expect(result.breakdown.child.count).toBe(2);
    expect(result.breakdown.monk.count).toBe(1);
    expect(result.totalSales).toBe(17400);
  });
});

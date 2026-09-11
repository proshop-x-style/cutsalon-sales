export type DailyReportBreakdown = {
  adult: { count: number; unitPrice: number; amount: number };
  junior: { count: number; unitPrice: number; amount: number };
  child: { count: number; unitPrice: number; amount: number };
  monk: { count: number; unitPrice: number; amount: number };
};

export type DailyReportSummary = {
  totalSales: number;
  totalCustomers: number;
  breakdown: DailyReportBreakdown;
};

const pricing = {
  adult: { unitPrice: 1800 },
  junior: { unitPrice: 1500 },
  child: { unitPrice: 1200 },
  monk: { unitPrice: 1500 },
};

function normalizeOcrNumberText(value: string) {
  return value
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/　/g, ' ');
}

function findLineByLabels(lines: string[], labels: string[]) {
  return lines.find((line) => labels.some((label) => line.includes(label))) ?? '';
}

function firstPlausibleCountFromText(value: string) {
  const normalized = normalizeOcrNumberText(value);
  const explicit = normalized.match(/(\d{1,3})\s*(?:人|名|枚|件)/);
  if (explicit?.[1]) {
    return Number(explicit[1]);
  }

  const numbers = [...normalized.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const plausible = numbers.find((num) => Number.isFinite(num) && num >= 0 && num <= 200);
  return plausible ?? 0;
}

function countFromLine(line: string): number {
  if (!line) {
    return 0;
  }

  const normalized = normalizeOcrNumberText(line).replace(/\d[\d,]*\s*円/g, '');
  return firstPlausibleCountFromText(normalized);
}

function countFromUnitAndAmount(line: string, unitPrice: number): number {
  const normalized = normalizeOcrNumberText(line);
  const amounts = [...normalized.matchAll(/(\d[\d,]*)\s*円/g)]
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (amounts.length === 0) {
    return 0;
  }

  const divisibleCounts = amounts
    .filter((amount) => amount >= unitPrice && amount % unitPrice === 0)
    .map((amount) => amount / unitPrice)
    .filter((count) => count >= 0 && count <= 200);

  if (divisibleCounts.length === 0) {
    return 0;
  }

  return Math.max(...divisibleCounts);
}

function countFromTextByLabels(text: string, labels: string[]): number {
  const normalized = normalizeOcrNumberText(text).replace(/\r/g, '\n');
  const allKnownLabels = [
    '大人券', '大人',
    '中高生券', '中高校生券', '中高券', '中高生', '中高校生', '中高', '高生',
    '小人券', '小児券', '子供券', 'こども券', '小学生以下', '小学生', '学生以下', '子供', 'こども', '小人', '小児',
    '坊主券', '坊主',
    '合計', '総計', '売上',
  ];

  const extractFromSegment = (startIndex: number, currentLabel: string) => {
    let endIndex = normalized.length;
    for (const otherLabel of allKnownLabels) {
      if (otherLabel === currentLabel) {
        continue;
      }

      const nextIndex = normalized.indexOf(otherLabel, startIndex + currentLabel.length);
      if (nextIndex !== -1 && nextIndex < endIndex) {
        endIndex = nextIndex;
      }
    }

    const segment = normalized.slice(startIndex, endIndex).replace(/\d[\d,]*\s*円/g, ' ');
    const explicit = segment.match(/(\d{1,3})\s*(?:人|名|枚|件)/);
    if (explicit?.[1]) {
      return Number(explicit[1]);
    }

    const numbers = [...segment.matchAll(/\d+/g)].map((match) => Number(match[0]));
    const plausible = numbers.find((num) => Number.isFinite(num) && num >= 0 && num <= 200);
    return plausible ?? 0;
  };

  const toCountOrZero = (value: string | undefined) => {
    const count = Number(value ?? '0');
    if (!Number.isFinite(count) || count < 0 || count > 200) {
      return 0;
    }
    return count;
  };

  for (const label of labels) {
    const labelIndex = normalized.indexOf(label);
    if (labelIndex !== -1) {
      const segmentedCount = toCountOrZero(String(extractFromSegment(labelIndex, label)));
      if (segmentedCount > 0) {
        return segmentedCount;
      }
    }

    const direct = text.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+)\\s*(?:人|名|枚|件)?`));
    const directCount = toCountOrZero(direct?.[1]);
    if (directCount > 0) {
      return directCount;
    }

    const near = text.match(new RegExp(`${label}[\\s\\S]{0,24}?(\\d+)\\s*(?:人|名|枚|件)?`));
    const nearCount = toCountOrZero(near?.[1]);
    if (nearCount > 0) {
      return nearCount;
    }

    const reversed = text.match(new RegExp(`(\\d+)\\s*(?:人|名|枚|件)?\\s*${label}`));
    const reversedCount = toCountOrZero(reversed?.[1]);
    if (reversedCount > 0) {
      return reversedCount;
    }
  }

  return 0;
}

function inferCountsByOrder(text: string) {
  const lines = normalizeOcrNumberText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .map((line) => ({
      line,
      count: firstPlausibleCountFromText(line),
    }))
    .filter(({ line, count }) => count > 0 && (/[円枚人件名]/.test(line) || /チケット|券売機|日計/.test(line)));

  if (candidates.length < 4) {
    return null;
  }

  const values = candidates.map((item) => item.count).slice(0, 4);
  return {
    adult: values[0] ?? 0,
    junior: values[1] ?? 0,
    child: values[2] ?? 0,
    monk: values[3] ?? 0,
  };
}

function inferCountsByUnitPrice(lines: string[]) {
  const adultLine = lines.find((line) => /1800/.test(line));
  const childLine = lines.find((line) => /1200/.test(line));
  const monkLine = lines.find((line) => /1500/.test(line) && /坊主/.test(line));
  const juniorLine = lines.find((line) =>
    /1500/.test(line)
    && !/坊主/.test(line)
    && /(?:中高|高生|学生|枚|人|名|件|円)/.test(line),
  );

  const adultByCount = adultLine ? countFromLine(adultLine) : 0;
  const juniorByCount = juniorLine ? countFromLine(juniorLine) : 0;
  const childByCount = childLine ? countFromLine(childLine) : 0;
  const monkByCount = monkLine ? countFromLine(monkLine) : 0;

  const adultByAmount = adultLine ? countFromUnitAndAmount(adultLine, 1800) : 0;
  const juniorByAmount = juniorLine ? countFromUnitAndAmount(juniorLine, 1500) : 0;
  const childByAmount = childLine ? countFromUnitAndAmount(childLine, 1200) : 0;
  const monkByAmount = monkLine ? countFromUnitAndAmount(monkLine, 1500) : 0;

  return {
    adult: adultByAmount || adultByCount,
    junior: juniorByAmount || juniorByCount,
    child: childByAmount || childByCount,
    monk: monkByAmount || monkByCount,
  };
}

export function calculateBreakdownTotal(breakdown: Partial<DailyReportBreakdown>): number {
  const adultCount = Number(breakdown.adult?.count ?? 0);
  const juniorCount = Number(breakdown.junior?.count ?? 0);
  const childCount = Number(breakdown.child?.count ?? 0);
  const monkCount = Number(breakdown.monk?.count ?? 0);

  return (
    adultCount * pricing.adult.unitPrice +
    juniorCount * pricing.junior.unitPrice +
    childCount * pricing.child.unitPrice +
    monkCount * pricing.monk.unitPrice
  );
}

export function parseDailyReportText(rawText: string): DailyReportSummary {
  const normalized = normalizeOcrNumberText(rawText).replace(/\r/g, '\n');
  const lines = normalized.split('\n').map((line) => line.trim());

  const adultLabels = ['大人券', '大人'];
  const juniorLabels = ['中高生券', '中高校生券', '中高券', '中高生', '中高校生', '中高', '高生'];
  const childLabels = ['小人券', '小児券', '子供券', 'こども券', '小学生以下', '小学生', '学生以下', '子供', 'こども', '小人', '小児'];
  const monkLabels = ['坊主券', '坊主'];

  const adultMatch = findLineByLabels(lines, adultLabels);
  const juniorMatch = findLineByLabels(lines, juniorLabels);
  const childMatch = findLineByLabels(lines, childLabels);
  const monkMatch = findLineByLabels(lines, monkLabels);

  const adultCount = countFromTextByLabels(normalized, adultLabels) || countFromLine(adultMatch);
  const juniorCount = countFromTextByLabels(normalized, juniorLabels) || countFromLine(juniorMatch);
  const childCount = countFromTextByLabels(normalized, childLabels) || countFromLine(childMatch);
  const monkCount = countFromTextByLabels(normalized, monkLabels) || countFromLine(monkMatch);

  const byUnitPrice = inferCountsByUnitPrice(lines);
  const inferred = inferCountsByOrder(normalized);
  const finalAdult = byUnitPrice.adult || adultCount || inferred?.adult || 0;
  const finalJunior = byUnitPrice.junior || juniorCount || inferred?.junior || 0;
  const finalChild = byUnitPrice.child || childCount || inferred?.child || 0;
  const finalMonk = byUnitPrice.monk || monkCount || inferred?.monk || 0;

  const adultAmount = finalAdult * pricing.adult.unitPrice;
  const juniorAmount = finalJunior * pricing.junior.unitPrice;
  const childAmount = finalChild * pricing.child.unitPrice;
  const monkAmount = finalMonk * pricing.monk.unitPrice;

  const totalSales = adultAmount + juniorAmount + childAmount + monkAmount;

  return {
    totalSales,
    totalCustomers: finalAdult + finalJunior + finalChild + finalMonk,
    breakdown: {
      adult: { count: finalAdult, unitPrice: pricing.adult.unitPrice, amount: adultAmount },
      junior: { count: finalJunior, unitPrice: pricing.junior.unitPrice, amount: juniorAmount },
      child: { count: finalChild, unitPrice: pricing.child.unitPrice, amount: childAmount },
      monk: { count: finalMonk, unitPrice: pricing.monk.unitPrice, amount: monkAmount },
    },
  };
}

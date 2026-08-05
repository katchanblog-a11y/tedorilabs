// セグメント判定と出口の出し分け
// フロント（単一HTML）と Worker の両方から import できる純関数のみ

// 保存する瞬間だけ 10万円単位に切り捨てる。表示は生値のまま。
export const roundForStats = (yen) =>
  Math.max(0, Math.floor((Number(yen) || 0) / 100000) * 100000);

export const roundMonthly = (yen) =>
  Math.max(0, Math.floor((Number(yen) || 0) / 10000) * 10000);

/**
 * セグメント判定
 * @param {object} r 計算結果と入力
 *   revenue, taxableIncome, invoiceRegistered, usesAccounting, usesAccountant,
 *   cashOnHandMonths（手元資金 ÷ 月間経費。不明なら null）
 */
export function classify(r) {
  const rev = Number(r.revenue) || 0;
  const taxable = Number(r.taxableIncome) || 0;

  if (r.cashOnHandMonths !== null && r.cashOnHandMonths !== undefined && r.cashOnHandMonths < 1) {
    return 'cashflow_watch';
  }
  if (taxable >= 9000000) return 'high';
  if (rev >= 10000000 || r.invoiceRegistered === 1) return 'taxable';
  if (rev >= 3000000) return 'growth';
  return 'starter';
}

// 出口の定義。priority が小さいほど上に出す。
// suppress: この条件に当てはまる人には出さない（無駄打ちを消す）
const OFFERS = {
  accounting_blue: {
    id: 'accounting_blue',
    label: '青色申告に対応した会計ソフト',
    note: '65万円控除を使うには複式簿記での記帳が必要です',
    suppress: (r) => r.usesAccounting && r.usesAccounting !== 'none' && r.usesAccounting !== 'unknown',
  },
  accounting_invoice: {
    id: 'accounting_invoice',
    label: 'インボイス対応の会計ソフト',
    note: '課税事業者は消費税の申告が別途必要になります',
    suppress: (r) => r.usesAccounting && r.usesAccounting !== 'none' && r.usesAccounting !== 'unknown',
  },
  accountant: {
    id: 'accountant',
    label: '税理士紹介サービス',
    note: '個別の判断は税理士へご相談ください',
    suppress: (r) => r.usesAccountant === 1,
  },
  incorporation: {
    id: 'incorporation',
    label: '法人成りの相談',
    note: '課税所得が大きくなると法人のほうが有利になる場合があります',
    suppress: (r) => r.workStyle === 'corporation',
  },
  kyosai: {
    id: 'kyosai',
    label: '小規模企業共済・iDeCo',
    note: '掛金が全額所得控除の対象になります',
    suppress: () => false,
  },
  business_card: {
    id: 'business_card',
    label: '事業用クレジットカード',
    note: '経費の記帳を分けると申告が楽になります',
    suppress: () => false,
  },
  // 資金繰りが厳しい層には公的融資を先に出す。
  // ファクタリングは手数料が重く、状況を悪化させうるため既定では出さない。
  public_loan: {
    id: 'public_loan',
    label: '日本政策金融公庫の融資制度',
    note: '民間より低利で、創業期でも利用しやすい制度があります',
    suppress: () => false,
  },
};

const MAP = {
  starter:        ['accounting_blue', 'business_card'],
  growth:         ['accounting_blue', 'kyosai', 'business_card'],
  taxable:        ['accountant', 'accounting_invoice', 'kyosai'],
  high:           ['accountant', 'incorporation', 'kyosai'],
  cashflow_watch: ['public_loan', 'accounting_blue'],
};

/**
 * 表示する出口を返す。suppress に当たるものは除外される。
 * 上位2件だけを結果画面に出し、残りはフッターに回すのが読みやすい。
 */
export function offersFor(segment, r) {
  return (MAP[segment] || MAP.starter)
    .map((k) => OFFERS[k])
    .filter((o) => o && !o.suppress(r));
}

// 統計テーブルに送る行を組み立てる。ここを通さずに書き込まない。
export function buildStatsRow(input, result, meta) {
  if (!meta.consentStats) return null;
  return {
    id: crypto.randomUUID(),
    tool_version: meta.toolVersion,
    consent_version: meta.consentVersion,
    session_hash: meta.sessionHash ?? null,

    occupation: input.occupation,
    work_style: input.workStyle,
    prefecture: input.prefecture ?? null,
    years_active: input.yearsActive ?? null,

    revenue_yen: roundForStats(input.revenue),
    expense_yen: roundForStats(input.expense),
    commission_rate: input.commissionRate ?? null,
    rent_fixed_yen: input.rentFixed != null ? roundMonthly(input.rentFixed) : null,

    filing_type: input.filingType ?? 'unknown',
    invoice_registered: input.invoiceRegistered ?? null,
    health_insurance: input.healthInsurance ?? 'unknown',
    pension_type: input.pensionType ?? 'unknown',
    dependents: input.dependents ?? null,
    accident_insurance: input.accidentInsurance ?? null,

    uses_accounting: input.usesAccounting ?? 'unknown',
    uses_accountant: input.usesAccountant ?? null,

    net_income_yen: Math.round(result.netIncome),
    income_tax_yen: Math.round(result.incomeTax),
    resident_tax_yen: Math.round(result.residentTax),
    health_ins_yen: Math.round(result.healthIns),
    pension_yen: Math.round(result.pension),
    consumption_tax_yen: Math.round(result.consumptionTax ?? 0),

    segment: result.segment,
    entry_source: meta.entrySource ?? 'direct',
    device: meta.device ?? null,
  };
}

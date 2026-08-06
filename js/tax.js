// tedorilabs / 手取り計算ロジック
// 2025年度（令和7年度）の制度をベースにした概算。
// 国民健康保険は自治体ごとに料率が異なるため、全国平均相当の概算値を使用。
//
// サロンへの支払い（歩合・席代）は事業の経費として扱う。
// すべて純関数。フロントとWorkerの両方から使える。

// ============================================================
// 定数
// ============================================================

const INCOME_TAX_BRACKETS = [
  { limit: 1950000, rate: 0.05, deduct: 0 },
  { limit: 3300000, rate: 0.10, deduct: 97500 },
  { limit: 6950000, rate: 0.20, deduct: 427500 },
  { limit: 9000000, rate: 0.23, deduct: 636000 },
  { limit: 18000000, rate: 0.33, deduct: 1536000 },
  { limit: 40000000, rate: 0.40, deduct: 2796000 },
  { limit: Infinity, rate: 0.45, deduct: 4796000 },
];

const CONST = {
  BASIC_DEDUCTION_INCOME: 480000,
  BASIC_DEDUCTION_RESIDENT: 430000,

  BLUE_65: 650000,
  BLUE_10: 100000,

  RECONSTRUCTION_RATE: 0.021,

  RESIDENT_RATE: 0.10,
  RESIDENT_PER_CAPITA: 5000,

  PENSION_MONTHLY: 17510,

  KOKUHO: {
    MEDICAL_RATE: 0.075,
    MEDICAL_PER_CAPITA: 45000,
    MEDICAL_CAP: 660000,

    SUPPORT_RATE: 0.028,
    SUPPORT_PER_CAPITA: 15000,
    SUPPORT_CAP: 260000,

    CARE_RATE: 0.024,
    CARE_PER_CAPITA: 16000,
    CARE_CAP: 170000,

    BASE_DEDUCTION: 430000,
  },

  DEPENDENT_DEDUCTION_INCOME: 380000,
  DEPENDENT_DEDUCTION_RESIDENT: 330000,

  CONSUMPTION_RATE: 0.10,
  SIMPLIFIED_PURCHASE_RATE: 0.5, // 簡易課税・第五種（サービス業）
};

// ============================================================
// 個別の計算
// ============================================================

/** 事業所得 = 売上 - 経費 - 青色申告特別控除 */
export function businessIncome(revenue, expense, filingType) {
  const gross = Math.max(0, revenue - expense);
  const blue =
    filingType === 'blue65' ? CONST.BLUE_65 :
    filingType === 'blue10' ? CONST.BLUE_10 : 0;
  return Math.max(0, gross - blue);
}

/** 所得税（復興特別所得税を含む） */
export function incomeTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  const b = INCOME_TAX_BRACKETS.find((x) => taxableIncome <= x.limit);
  const base = Math.max(0, taxableIncome * b.rate - b.deduct);
  return Math.floor(base * (1 + CONST.RECONSTRUCTION_RATE));
}

/** 住民税（所得割 + 均等割） */
export function residentTax(taxableIncomeForResident) {
  if (taxableIncomeForResident <= 0) return CONST.RESIDENT_PER_CAPITA;
  return Math.floor(
    taxableIncomeForResident * CONST.RESIDENT_RATE + CONST.RESIDENT_PER_CAPITA
  );
}

/** 国民健康保険料（全国平均相当の概算） */
export function healthInsurance(businessInc, members = 1, needsCare = false) {
  const K = CONST.KOKUHO;
  const base = Math.max(0, businessInc - K.BASE_DEDUCTION);

  const medical = Math.min(base * K.MEDICAL_RATE + K.MEDICAL_PER_CAPITA * members, K.MEDICAL_CAP);
  const support = Math.min(base * K.SUPPORT_RATE + K.SUPPORT_PER_CAPITA * members, K.SUPPORT_CAP);
  const care = needsCare
    ? Math.min(base * K.CARE_RATE + K.CARE_PER_CAPITA, K.CARE_CAP)
    : 0;

  return Math.floor(medical + support + care);
}

/** 国民年金（年額） */
export function pension(months = 12) {
  return CONST.PENSION_MONTHLY * months;
}

/** 消費税（簡易課税・サービス業を想定した概算） */
export function consumptionTax(revenue, isTaxable) {
  if (!isTaxable) return 0;
  const received = revenue * CONST.CONSUMPTION_RATE;
  return Math.floor(received * (1 - CONST.SIMPLIFIED_PURCHASE_RATE));
}

// ============================================================
// 総合計算
// ============================================================

/**
 * @param {object} input
 *   revenue           年間売上（サロンに支払う前の総額）
 *   expense           年間経費（サロンへの支払いを含めた総額）
 *   filingType        'blue65' | 'blue10' | 'white'
 *   dependents        扶養親族の数
 *   householdMembers  国保の世帯加入人数
 *   age40to64         介護保険の対象か
 *   isTaxableBusiness 消費税の課税事業者か
 *   socialInsurance   社保加入の場合の年間本人負担額（比較用。既定null）
 */
export function calculate(input) {
  const revenue = Math.max(0, Number(input.revenue) || 0);
  const expense = Math.max(0, Number(input.expense) || 0);
  const dependents = Math.max(0, Number(input.dependents) || 0);
  const members = Math.max(1, Number(input.householdMembers) || 1);

  const bizIncome = businessIncome(revenue, expense, input.filingType);

  // 健康保険：市町村国保は所得連動、国保組合は定額、扶養は0円
  const healthIns =
    input.socialInsurance != null
      ? Math.max(0, Number(input.socialInsurance))
      : input.healthType === 'union'
        ? Math.max(0, Number(input.healthMonthly) || 0) * 12
        : input.healthType === 'dependent'
          ? 0
          : healthInsurance(bizIncome, members, !!input.age40to64);

  const pensionAmount = input.socialInsurance != null ? 0 : pension();
  const socialDeduction = healthIns + pensionAmount;

  const taxableIncome = Math.max(
    0,
    bizIncome - socialDeduction - CONST.BASIC_DEDUCTION_INCOME
      - dependents * CONST.DEPENDENT_DEDUCTION_INCOME
  );

  const taxableResident = Math.max(
    0,
    bizIncome - socialDeduction - CONST.BASIC_DEDUCTION_RESIDENT
      - dependents * CONST.DEPENDENT_DEDUCTION_RESIDENT
  );

  const income = incomeTax(taxableIncome);
  const resident = residentTax(taxableResident);
  const consumption = consumptionTax(revenue, !!input.isTaxableBusiness);

  const totalBurden = income + resident + healthIns + pensionAmount + consumption;
  const netIncome = revenue - expense - totalBurden;

  return {
    revenue,
    expense,
    businessIncome: bizIncome,
    taxableIncome,
    incomeTax: income,
    residentTax: resident,
    healthIns,
    pension: pensionAmount,
    consumptionTax: consumption,
    totalBurden,
    netIncome,
    netRate: revenue > 0 ? netIncome / revenue : 0,
  };
}

/**
 * サロンへの支払い方式ごとの年間支払額を求める。
 *
 * @param {number} revenue 年間売上（総額）
 * @param {object} cfg
 *   type        'commission' | 'fixed' | 'both' | 'spot' | 'none'
 *   share       自分の取り分（％）… commission / both で使用
 *   rentMonthly 月額席代（円）… fixed / both で使用
 *   spotHourly  時間単価（円）… spot で使用
 *   spotHours   月の利用時間（時間）… spot で使用
 * @returns {number} 年間のサロン支払額
 */
export function salonPayment(revenue, cfg = {}) {
  const rev = Math.max(0, Number(revenue) || 0);
  const share = Math.min(100, Math.max(0, Number(cfg.share) || 0)) / 100;
  const rent = Math.max(0, Number(cfg.rentMonthly) || 0) * 12;
  const spot = Math.max(0, Number(cfg.spotHourly) || 0) * Math.max(0, Number(cfg.spotHours) || 0) * 12;

  switch (cfg.type) {
    case 'commission': return Math.floor(rev * (1 - share));
    case 'fixed':      return rent;
    case 'both':       return Math.floor(rev * (1 - share)) + rent;
    case 'spot':       return spot;
    default:           return 0;
  }
}

/**
 * 条件を変えた場合の比較。
 * サロン支払いは経費に上乗せするだけなので、追加経費だけを渡す。
 *
 * @param {object} base    calculate() と同じ入力（expense はサロン支払いを含まない額）
 * @param {object} styles  { key: { extraExpense } }
 */
export function compareWorkStyles(base, styles) {
  const out = {};
  for (const [key, cfg] of Object.entries(styles)) {
    out[key] = calculate({
      ...base,
      expense: base.expense + Math.max(0, cfg.extraExpense || 0),
    });
  }
  return out;
}

export const CONSTANTS = CONST;

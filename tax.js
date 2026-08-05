// tedorilabs / 手取り計算ロジック
// 2025年度（令和7年度）の制度をベースにした概算。
// 国民健康保険は自治体ごとに料率が異なるため、全国平均相当の概算値を使用。
//
// すべて純関数。フロントとWorkerの両方から使える。

// ============================================================
// 定数
// ============================================================

// 所得税の速算表（課税所得に対する税率と控除額）
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
  // 基礎控除
  BASIC_DEDUCTION_INCOME: 480000,   // 所得税
  BASIC_DEDUCTION_RESIDENT: 430000, // 住民税

  // 青色申告特別控除
  BLUE_65: 650000,
  BLUE_10: 100000,

  // 復興特別所得税
  RECONSTRUCTION_RATE: 0.021,

  // 住民税
  RESIDENT_RATE: 0.10,        // 所得割（市町村6% + 道府県4%）
  RESIDENT_PER_CAPITA: 5000,  // 均等割（森林環境税1,000円を含む概算）

  // 国民年金（月額 × 12）
  PENSION_MONTHLY: 17510,

  // 国民健康保険（全国平均相当の概算）
  KOKUHO: {
    MEDICAL_RATE: 0.075,      // 医療分・所得割
    MEDICAL_PER_CAPITA: 45000,
    MEDICAL_CAP: 660000,

    SUPPORT_RATE: 0.028,      // 後期高齢者支援分・所得割
    SUPPORT_PER_CAPITA: 15000,
    SUPPORT_CAP: 260000,

    CARE_RATE: 0.024,         // 介護分（40〜64歳のみ）
    CARE_PER_CAPITA: 16000,
    CARE_CAP: 170000,

    BASE_DEDUCTION: 430000,   // 国保の所得割算定時の基礎控除
  },

  // 扶養控除（一般）
  DEPENDENT_DEDUCTION_INCOME: 380000,
  DEPENDENT_DEDUCTION_RESIDENT: 330000,

  // 消費税（簡易課税・第五種サービス業のみなし仕入率50%）
  CONSUMPTION_RATE: 0.10,
  SIMPLIFIED_PURCHASE_RATE: 0.5,
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

/**
 * 国民健康保険料（全国平均相当の概算）
 * @param {number} businessInc 事業所得
 * @param {number} members 世帯の加入人数
 * @param {boolean} needsCare 40〜64歳かどうか
 */
export function healthInsurance(businessInc, members = 1, needsCare = false) {
  const K = CONST.KOKUHO;
  const base = Math.max(0, businessInc - K.BASE_DEDUCTION);

  const medical = Math.min(
    base * K.MEDICAL_RATE + K.MEDICAL_PER_CAPITA * members,
    K.MEDICAL_CAP
  );
  const support = Math.min(
    base * K.SUPPORT_RATE + K.SUPPORT_PER_CAPITA * members,
    K.SUPPORT_CAP
  );
  const care = needsCare
    ? Math.min(base * K.CARE_RATE + K.CARE_PER_CAPITA, K.CARE_CAP)
    : 0;

  return Math.floor(medical + support + care);
}

/** 国民年金（年額） */
export function pension(months = 12) {
  return CONST.PENSION_MONTHLY * months;
}

/**
 * 消費税（簡易課税・サービス業を想定した概算）
 * 課税事業者でない場合は0
 */
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
 *   revenue           年間売上
 *   expense           年間経費
 *   filingType        'blue65' | 'blue10' | 'white'
 *   dependents        扶養親族の数
 *   householdMembers  国保の世帯加入人数（既定1）
 *   age40to64         介護保険の対象か
 *   isTaxableBusiness 消費税の課税事業者か
 *   socialInsurance   社保加入の場合の年間本人負担額（面貸し以外の比較用。既定null）
 */
export function calculate(input) {
  const revenue = Math.max(0, Number(input.revenue) || 0);
  const expense = Math.max(0, Number(input.expense) || 0);
  const dependents = Math.max(0, Number(input.dependents) || 0);
  const members = Math.max(1, Number(input.householdMembers) || 1);

  const bizIncome = businessIncome(revenue, expense, input.filingType);

  // 社会保険料控除の対象となる額
  const healthIns =
    input.socialInsurance != null
      ? Math.max(0, Number(input.socialInsurance))
      : healthInsurance(bizIncome, members, !!input.age40to64);

  const pensionAmount = input.socialInsurance != null ? 0 : pension();
  const socialDeduction = healthIns + pensionAmount;

  // 所得税の課税所得
  const taxableIncome = Math.max(
    0,
    bizIncome -
      socialDeduction -
      CONST.BASIC_DEDUCTION_INCOME -
      dependents * CONST.DEPENDENT_DEDUCTION_INCOME
  );

  // 住民税の課税所得（控除額が所得税と異なる）
  const taxableResident = Math.max(
    0,
    bizIncome -
      socialDeduction -
      CONST.BASIC_DEDUCTION_RESIDENT -
      dependents * CONST.DEPENDENT_DEDUCTION_RESIDENT
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
    // 手取り率。売上に対する割合
    netRate: revenue > 0 ? netIncome / revenue : 0,
  };
}

/**
 * 働き方別の比較。同じ売上で手取りがどう変わるかを出す。
 * 面貸し・業務委託は歩合率と固定家賃を考慮する。
 *
 * @param {object} base   calculate() と同じ入力
 * @param {object} styles { chair_rental: {commissionRate, rentMonthly}, ... }
 */
export function compareWorkStyles(base, styles) {
  const out = {};
  for (const [key, cfg] of Object.entries(styles)) {
    const rate = cfg.commissionRate != null ? cfg.commissionRate / 100 : 1;
    const rent = (cfg.rentMonthly || 0) * 12;

    // 売上のうち自分の取り分
    const myRevenue = Math.floor(base.revenue * rate);
    const myExpense = base.expense + rent;

    out[key] = calculate({ ...base, revenue: myRevenue, expense: myExpense });
  }
  return out;
}

export const CONSTANTS = CONST;

-- フリーランス手取りシミュレータ / Cloudflare D1 (SQLite)
-- 統計用（simulations, cta_events）と 個人用（accounts, snapshots）は紐付けない

PRAGMA foreign_keys = ON;

-- ============================================================
-- 統計用：個人と紐付かない。追記のみ。同意した行だけ入る。
-- ============================================================
CREATE TABLE IF NOT EXISTS simulations (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  tool_version      TEXT NOT NULL,
  consent_version   TEXT NOT NULL,
  session_hash      TEXT,          -- 日次ローテーションするハッシュ。重複除去用。個人IDではない

  -- 属性
  occupation        TEXT NOT NULL, -- hairdresser / photographer / engineer / writer / driver / other
  work_style        TEXT NOT NULL, -- employee / contract / chair_rental / share_salon / home / corporation
  prefecture        TEXT,
  years_active      INTEGER,

  -- 収支（10万円単位に切り捨て済み）
  revenue_yen       INTEGER NOT NULL,
  expense_yen       INTEGER NOT NULL,
  commission_rate   INTEGER,       -- 歩合率 %。面貸し・業務委託のみ
  rent_fixed_yen    INTEGER,       -- 面貸しの固定家賃（月額、1万円単位）

  -- 制度まわり
  filing_type       TEXT,          -- blue65 / blue10 / white / unknown
  invoice_registered INTEGER,      -- 0 / 1 / NULL
  health_insurance  TEXT,          -- kokuho / union / dependent / shaho / unknown
  pension_type      TEXT,          -- kokumin / kosei / unknown
  dependents        INTEGER,
  accident_insurance INTEGER,      -- 労災特別加入 0 / 1

  -- 現在の利用状況（出口の出し分けに使う）
  uses_accounting   TEXT,          -- none / freee / mf / yayoi / other / unknown
  uses_accountant   INTEGER,       -- 税理士利用 0 / 1

  -- 計算結果
  net_income_yen    INTEGER,
  income_tax_yen    INTEGER,
  resident_tax_yen  INTEGER,
  health_ins_yen    INTEGER,
  pension_yen       INTEGER,
  consumption_tax_yen INTEGER,

  -- 分類・流入
  segment           TEXT NOT NULL,
  entry_source      TEXT,          -- organic / sns / direct / partner:xxxx
  device            TEXT           -- ios / android / desktop
);

CREATE INDEX IF NOT EXISTS idx_sim_occ_style ON simulations(occupation, work_style);
CREATE INDEX IF NOT EXISTS idx_sim_created   ON simulations(created_at);
CREATE INDEX IF NOT EXISTS idx_sim_segment   ON simulations(segment);
CREATE INDEX IF NOT EXISTS idx_sim_source    ON simulations(entry_source);

-- ============================================================
-- 出口の表示・クリックログ。どのセグメントに何が刺さるかを測る
-- ============================================================
CREATE TABLE IF NOT EXISTS cta_events (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  simulation_id TEXT REFERENCES simulations(id),
  segment       TEXT NOT NULL,
  slot          TEXT NOT NULL,   -- result_primary / result_secondary / footer / email
  offer_id      TEXT NOT NULL,   -- freee / mf / zeirishi_a / kouko / card_x
  action        TEXT NOT NULL    -- impression / click
);

CREATE INDEX IF NOT EXISTS idx_cta_seg_offer ON cta_events(segment, offer_id, action);
CREATE INDEX IF NOT EXISTS idx_cta_created   ON cta_events(created_at);

-- ============================================================
-- 個人用：リスト化。統計テーブルとは結合しない
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  email_hash        TEXT NOT NULL UNIQUE,  -- 照合用（SHA-256 + salt）
  email_enc         TEXT NOT NULL,         -- 配信用（暗号化して保管。平文で置かない）
  occupation        TEXT,
  work_style        TEXT,
  fiscal_start_month INTEGER DEFAULT 1,
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active'  -- active / unsubscribed
);

CREATE INDEX IF NOT EXISTS idx_acc_status ON accounts(status);

-- 月次の売上・経費記録。「今年の予想納税額」を常時出すための元データ
CREATE TABLE IF NOT EXISTS snapshots (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,        -- 'YYYY-MM'
  revenue_yen  INTEGER NOT NULL,     -- こちらは丸めない（本人のための記録）
  expense_yen  INTEGER NOT NULL,
  memo         TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, period)
);

CREATE INDEX IF NOT EXISTS idx_snap_account ON snapshots(account_id, period);

-- ============================================================
-- 独自調査記事のための集計ビュー
-- 件数10未満のグループは出さない（個人特定を避ける）
-- ============================================================
CREATE VIEW IF NOT EXISTS v_commission_by_style AS
SELECT
  occupation,
  work_style,
  COUNT(*)                AS n,
  AVG(commission_rate)    AS avg_rate,
  MIN(commission_rate)    AS min_rate,
  MAX(commission_rate)    AS max_rate
FROM simulations
WHERE commission_rate IS NOT NULL
GROUP BY occupation, work_style
HAVING COUNT(*) >= 10;

CREATE VIEW IF NOT EXISTS v_expense_ratio AS
SELECT
  occupation,
  COUNT(*) AS n,
  AVG(CAST(expense_yen AS REAL) / NULLIF(revenue_yen, 0)) AS avg_expense_ratio
FROM simulations
WHERE revenue_yen > 0
GROUP BY occupation
HAVING COUNT(*) >= 10;

-- 「売上1000万超なのに税理士なし」= 税理士紹介の最有力層
CREATE VIEW IF NOT EXISTS v_accountant_gap AS
SELECT
  occupation,
  COUNT(*) AS n,
  SUM(CASE WHEN uses_accountant = 0 THEN 1 ELSE 0 END) AS without_accountant
FROM simulations
WHERE revenue_yen >= 10000000
GROUP BY occupation
HAVING COUNT(*) >= 10;

-- ============================================================
-- AgriSense PH — Supabase Database Setup
-- I-copy ang buong SQL na ito at i-paste sa:
-- Supabase Console → SQL Editor → New query → I-click Run
-- ============================================================

-- ── USERS TABLE ───────────────────────────────────────────────
-- Naglalaman ng profile ng bawat farmer, admin, at DA officer
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY,           -- Mula sa Supabase Auth
  name        TEXT NOT NULL,              -- Buong pangalan
  email       TEXT NOT NULL UNIQUE,       -- Email address
  role        TEXT NOT NULL DEFAULT 'farmer', -- farmer, admin, da_officer
  barangay    TEXT,                       -- Para sa farmers
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── DETECTIONS TABLE ──────────────────────────────────────────
-- Bawat detection result ng AI — puso ng sistema
CREATE TABLE IF NOT EXISTS detections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  crop          TEXT NOT NULL,            -- rice o tomato
  disease       TEXT NOT NULL,            -- pangalan ng sakit
  confidence    INTEGER NOT NULL,         -- 0-100 percent
  severity      TEXT,                     -- mild, moderate, severe
  all_scores    TEXT,                     -- JSON string ng lahat ng scores
  -- Weather data sa oras ng detection
  temperature   DECIMAL,
  humidity      INTEGER,
  rain          DECIMAL,
  wind          INTEGER,
  location_name TEXT,                     -- hal. "Angeles City, Pampanga"
  latitude      DECIMAL,
  longitude     DECIMAL,
  -- Photo
  photo_url     TEXT,
  -- Timestamp
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── ALERTS TABLE ──────────────────────────────────────────────
-- Outbreak alerts para sa Admin at DA Officer
CREATE TABLE IF NOT EXISTS alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disease        TEXT NOT NULL,
  severity       TEXT NOT NULL,           -- medium o high
  location_name  TEXT,
  latitude       DECIMAL,
  longitude      DECIMAL,
  affected_count INTEGER DEFAULT 0,
  message        TEXT,
  resolved       BOOLEAN DEFAULT false,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROW LEVEL SECURITY (RLS) ──────────────────────────────────
-- Pinipigilan ang hindi authorized na access sa data

-- I-enable ang RLS sa lahat ng tables
ALTER TABLE users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts     ENABLE ROW LEVEL SECURITY;

-- Users policies
-- Makikita ng user ang sariling profile
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Puwedeng i-update ng user ang sariling profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Puwedeng gumawa ng bagong user profile
CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Makikita ng admin/DA ang lahat ng users
CREATE POLICY "Admin can view all users"
  ON users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'da_officer')
    )
  );

-- Detections policies
-- Puwedeng gumawa ng detection ang kahit sinong naka-login
CREATE POLICY "Logged in users can create detections"
  ON detections FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Makikita ng farmer ang sariling detections
CREATE POLICY "Farmers can view own detections"
  ON detections FOR SELECT
  USING (auth.uid() = user_id);

-- Makikita ng admin/DA ang lahat ng detections
CREATE POLICY "Admin can view all detections"
  ON detections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'da_officer')
    )
  );

-- Alerts policies
-- Makikita ng lahat ng naka-login ang alerts
CREATE POLICY "All users can view alerts"
  ON alerts FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Gumawa at mag-update ng alert ang admin/DA lang
CREATE POLICY "Admin can manage alerts"
  ON alerts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('admin', 'da_officer')
    )
  );

-- ── INDEXES ───────────────────────────────────────────────────
-- Para mas mabilis ang queries

CREATE INDEX IF NOT EXISTS idx_detections_user_id
  ON detections(user_id);

CREATE INDEX IF NOT EXISTS idx_detections_created_at
  ON detections(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_detections_disease
  ON detections(disease);

CREATE INDEX IF NOT EXISTS idx_detections_crop
  ON detections(crop);

CREATE INDEX IF NOT EXISTS idx_alerts_resolved
  ON alerts(resolved);

-- ── SAMPLE DATA (para sa testing) ────────────────────────────
-- I-uncomment ito kung gusto mong maglagay ng test data
-- (Palitan ng actual user IDs pagkatapos mag-register)

-- INSERT INTO detections (user_id, crop, disease, confidence, severity, location_name, created_at)
-- VALUES
--   ('your-user-id-here', 'rice', 'Rice Blast', 88, 'moderate', 'Angeles City, Pampanga', NOW()),
--   ('your-user-id-here', 'rice', 'Brown Spot', 75, 'mild', 'San Fernando, Pampanga', NOW() - INTERVAL '1 day'),
--   ('your-user-id-here', 'tomato', 'Early Blight', 92, 'severe', 'Cabanatuan City, Nueva Ecija', NOW() - INTERVAL '2 days');

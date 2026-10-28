-- Migration 001: the initial Stride schema, row-level security and the delete-athlete procedure.
-- Applied in order by the migration runner (apps/api/src/lib/migrations.ts), which records it in
-- stride.schema_migrations. Batches are separated by GO lines. Foreign keys do not cascade.
--
-- Differences from the specification's starting DDL (see docs/decisions.md):
--   * invites.created_by is nullable: the first admin invite is created by StatEdge staff scripts.
--   * clips.fingerprint is added here, as the offline section requires.
--   * report_frames holds a report's private key frames before a public copy is made.
--   * coaches and invites have filter predicates that also admit the one row matching a verified
--     identity (entra_oid) or invite token hash held in session context, so that a coach can be
--     resolved, and an invite accepted, before the organisation is known.

IF SCHEMA_ID(N'stride') IS NULL EXEC (N'CREATE SCHEMA stride');
GO

CREATE TABLE stride.organisations (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_organisations PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  name NVARCHAR(200) NOT NULL,
  type VARCHAR(10) NOT NULL CONSTRAINT CK_org_type CHECK (type IN ('school','club','practice')),
  tournament_school_id UNIQUEIDENTIFIER NULL,   -- optional link to the Tournament Manager schools directory
  max_coaches INT NOT NULL CONSTRAINT DF_org_max DEFAULT 2,
  clip_retention_days INT NOT NULL CONSTRAINT DF_org_ret DEFAULT 90
    CONSTRAINT CK_org_ret CHECK (clip_retention_days BETWEEN 1 AND 365),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_org_created DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.coaches (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_coaches PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_coaches_org REFERENCES stride.organisations(id),
  entra_oid UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_coaches_oid UNIQUE,  -- 'oid' claim in the token
  email NVARCHAR(320) NOT NULL,
  display_name NVARCHAR(200) NULL,
  role VARCHAR(10) NOT NULL CONSTRAINT CK_coach_role CHECK (role IN ('admin','coach')),
  status VARCHAR(10) NOT NULL CONSTRAINT DF_coach_status DEFAULT 'active'
    CONSTRAINT CK_coach_status CHECK (status IN ('active','removed')),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_coach_created DEFAULT SYSUTCDATETIME(),
  last_seen_at DATETIME2(0) NULL
);
CREATE INDEX IX_coaches_org ON stride.coaches(org_id, status);

CREATE TABLE stride.invites (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_invites PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_invites_org REFERENCES stride.organisations(id),
  email NVARCHAR(320) NOT NULL,
  role VARCHAR(10) NOT NULL CONSTRAINT CK_invite_role CHECK (role IN ('admin','coach')),
  token_hash VARBINARY(32) NOT NULL,
  expires_at DATETIME2(0) NOT NULL,
  accepted_at DATETIME2(0) NULL,
  created_by UNIQUEIDENTIFIER NULL CONSTRAINT FK_invites_coach REFERENCES stride.coaches(id),  -- NULL: staff script
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_invite_created DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_invites_token ON stride.invites(token_hash);
CREATE INDEX IX_invites_org ON stride.invites(org_id, accepted_at, expires_at);

CREATE TABLE stride.athletes (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_athletes PRIMARY KEY,                -- client-generated
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_athletes_org REFERENCES stride.organisations(id),
  first_name NVARCHAR(100) NOT NULL,
  last_name NVARCHAR(100) NOT NULL,
  birth_year SMALLINT NOT NULL CONSTRAINT CK_athlete_birth CHECK (birth_year BETWEEN 1940 AND 2100),
  external_ref NVARCHAR(50) NULL,                          -- the school's own athlete number
  created_by UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_athletes_coach REFERENCES stride.coaches(id),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_athlete_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_athletes_org_name ON stride.athletes(org_id, last_name, first_name);

CREATE TABLE stride.consents (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_consents PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_consents_org REFERENCES stride.organisations(id),
  athlete_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_consents_athlete REFERENCES stride.athletes(id),
  purpose VARCHAR(12) NOT NULL CONSTRAINT CK_consent_purpose CHECK (purpose IN ('analysis','clip_storage','sharing')),
  given_by VARCHAR(10) NOT NULL CONSTRAINT CK_consent_given_by CHECK (given_by IN ('athlete','guardian')),
  given_by_name NVARCHAR(200) NOT NULL,
  relationship NVARCHAR(50) NULL,
  evidence VARCHAR(12) NOT NULL CONSTRAINT CK_consent_evidence CHECK (evidence IN ('paper_form','digital','verbal')),
  given_on DATE NOT NULL,
  recorded_by UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_consents_coach REFERENCES stride.coaches(id),
  recorded_at DATETIME2(0) NOT NULL CONSTRAINT DF_consent_recorded DEFAULT SYSUTCDATETIME(),
  withdrawn_at DATETIME2(0) NULL
);
CREATE UNIQUE INDEX UX_consents_active ON stride.consents(athlete_id, purpose) WHERE withdrawn_at IS NULL;

CREATE TABLE stride.sessions (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sessions PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sessions_org REFERENCES stride.organisations(id),
  created_by UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sessions_coach REFERENCES stride.coaches(id),
  session_date DATE NOT NULL,
  place NVARCHAR(200) NULL,
  surface VARCHAR(12) NULL CONSTRAINT CK_session_surface CHECK (surface IN ('track','grass','treadmill','road','other')),
  footwear NVARCHAR(100) NULL,
  mode VARCHAR(10) NOT NULL CONSTRAINT CK_session_mode CHECK (mode IN ('sprint','distance')),
  notes NVARCHAR(1000) NULL,
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_session_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_sessions_org_date ON stride.sessions(org_id, session_date DESC);

CREATE TABLE stride.calibrations (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_calibrations PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_calibrations_org REFERENCES stride.organisations(id),
  session_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_calibrations_session REFERENCES stride.sessions(id),
  distance_m DECIMAL(6,3) NOT NULL CONSTRAINT CK_calibration_distance CHECK (distance_m > 0),
  marker_ax REAL NOT NULL, marker_ay REAL NOT NULL,
  marker_bx REAL NOT NULL, marker_by REAL NOT NULL,
  px_per_m REAL NOT NULL CONSTRAINT CK_calibration_scale CHECK (px_per_m > 0),
  frame_width INT NOT NULL, frame_height INT NOT NULL,
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_calibration_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_calibrations_session ON stride.calibrations(session_id);

CREATE TABLE stride.clips (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_clips PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_clips_org REFERENCES stride.organisations(id),
  session_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_clips_session REFERENCES stride.sessions(id),
  athlete_id UNIQUEIDENTIFIER NULL CONSTRAINT FK_clips_athlete REFERENCES stride.athletes(id),   -- null for calibration clips
  role VARCHAR(12) NOT NULL CONSTRAINT CK_clip_role CHECK (role IN ('calibration','run')),
  calibration_id UNIQUEIDENTIFIER NULL CONSTRAINT FK_clips_calibration REFERENCES stride.calibrations(id),
  device_model NVARCHAR(100) NULL,
  declared_fps SMALLINT NOT NULL, detected_fps REAL NULL,
  width_px INT NOT NULL, height_px INT NOT NULL,
  frame_count INT NOT NULL, duration_sec REAL NOT NULL,
  codec VARCHAR(30) NULL,
  direction SMALLINT NULL CONSTRAINT CK_clip_direction CHECK (direction IN (-1, 1)),
  fingerprint CHAR(64) NULL,                 -- SHA-256 of the first megabyte plus the size
  storage_path NVARCHAR(400) NULL,           -- stretch: set only for opt-in uploads
  delete_after DATETIME2(0) NULL,
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_clip_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_clips_session ON stride.clips(session_id);
CREATE INDEX IX_clips_athlete ON stride.clips(athlete_id);

CREATE TABLE stride.analyses (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_analyses PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_analyses_org REFERENCES stride.organisations(id),
  clip_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_analyses_clip REFERENCES stride.clips(id),
  athlete_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_analyses_athlete REFERENCES stride.athletes(id),
  algorithm_version VARCHAR(30) NOT NULL,
  pose_model VARCHAR(60) NOT NULL,
  gate_status VARCHAR(12) NOT NULL CONSTRAINT CK_analysis_gate CHECK (gate_status IN ('pass','conditional')),
  result_json NVARCHAR(MAX) NOT NULL CONSTRAINT CK_analysis_json CHECK (ISJSON(result_json) = 1),
  keypoints VARBINARY(MAX) NULL,             -- gzip of the SKP1 file
  keypoints_bytes INT NULL,                  -- size of the stored (compressed) file
  created_by UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_analyses_coach REFERENCES stride.coaches(id),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_analysis_created DEFAULT SYSUTCDATETIME(),
  superseded_by UNIQUEIDENTIFIER NULL        -- set when re-analysed with a newer algorithm
);
CREATE INDEX IX_analyses_athlete ON stride.analyses(athlete_id, created_at DESC);
CREATE INDEX IX_analyses_clip ON stride.analyses(clip_id);

CREATE TABLE stride.analysis_metrics (
  analysis_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_metrics_analysis REFERENCES stride.analyses(id),
  org_id UNIQUEIDENTIFIER NOT NULL,
  metric_id VARCHAR(40) NOT NULL,
  value REAL NULL, left_value REAL NULL, right_value REAL NULL, sd REAL NULL,
  n SMALLINT NOT NULL, unit VARCHAR(16) NOT NULL,
  confidence VARCHAR(12) NOT NULL CONSTRAINT CK_metric_confidence CHECK (confidence IN ('high','medium','low','unavailable')),
  CONSTRAINT PK_analysis_metrics PRIMARY KEY (analysis_id, metric_id)
);

CREATE TABLE stride.notes (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_notes PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  analysis_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_notes_analysis REFERENCES stride.analyses(id),
  coach_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_notes_coach REFERENCES stride.coaches(id),
  body NVARCHAR(2000) NOT NULL,
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_note_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_note_updated DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_notes_analysis ON stride.notes(analysis_id);

CREATE TABLE stride.reports (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_reports PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  athlete_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_reports_athlete REFERENCES stride.athletes(id),
  created_by UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_reports_coach REFERENCES stride.coaches(id),
  title NVARCHAR(200) NOT NULL,
  snapshot_json NVARCHAR(MAX) NOT NULL CONSTRAINT CK_report_json CHECK (ISJSON(snapshot_json) = 1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_report_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_reports_athlete ON stride.reports(athlete_id);

-- A report's key frames before sharing (at most five), copied to shared_report_frames on share.
CREATE TABLE stride.report_frames (
  report_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_report_frames_report REFERENCES stride.reports(id),
  org_id UNIQUEIDENTIFIER NOT NULL,
  ordinal TINYINT NOT NULL CONSTRAINT CK_report_frame_ordinal CHECK (ordinal BETWEEN 1 AND 5),
  jpeg VARBINARY(MAX) NOT NULL,
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_report_frame_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_report_frames PRIMARY KEY (report_id, ordinal)
);

-- Public copies. No org_id predicate: protected by an unguessable token. First name and initial only.
CREATE TABLE stride.shared_reports (
  token_hash VARBINARY(32) NOT NULL CONSTRAINT PK_shared_reports PRIMARY KEY,
  report_id UNIQUEIDENTIFIER NOT NULL,
  org_id UNIQUEIDENTIFIER NOT NULL,
  snapshot_json NVARCHAR(MAX) NOT NULL CONSTRAINT CK_shared_json CHECK (ISJSON(snapshot_json) = 1),
  expires_at DATETIME2(0) NOT NULL,
  revoked_at DATETIME2(0) NULL,
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_shared_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_shared_reports_report ON stride.shared_reports(org_id, report_id);
CREATE TABLE stride.shared_report_frames (
  token_hash VARBINARY(32) NOT NULL CONSTRAINT FK_shared_frames_report REFERENCES stride.shared_reports(token_hash),
  ordinal TINYINT NOT NULL, label VARCHAR(30) NOT NULL, jpeg VARBINARY(MAX) NOT NULL,
  CONSTRAINT PK_shared_frames PRIMARY KEY (token_hash, ordinal)
);

CREATE TABLE stride.device_profiles (            -- maintained by StatEdge, readable by all
  id INT IDENTITY CONSTRAINT PK_device_profiles PRIMARY KEY,
  model NVARCHAR(100) NOT NULL, tier CHAR(1) NOT NULL CONSTRAINT CK_device_tier CHECK (tier IN ('A','B','C')),
  max_slowmo NVARCHAR(60) NULL, notes NVARCHAR(400) NULL,
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_device_profile_updated DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.device_checks (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_device_checks PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  device_model NVARCHAR(100) NULL, os NVARCHAR(50) NULL, browser NVARCHAR(100) NULL,
  declared_fps SMALLINT NULL, detected_fps REAL NULL,
  width_px INT NULL, height_px INT NULL, codec VARCHAR(30) NULL, timing_jitter REAL NULL,
  result VARCHAR(12) NOT NULL CONSTRAINT CK_device_check_result CHECK (result IN ('pass','conditional','fail')),
  reason NVARCHAR(400) NULL,
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_device_check_created DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.audit_log (
  id BIGINT IDENTITY CONSTRAINT PK_audit_log PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  coach_id UNIQUEIDENTIFIER NULL,
  action VARCHAR(40) NOT NULL,
  target_type VARCHAR(30) NULL, target_id UNIQUEIDENTIFIER NULL,
  detail NVARCHAR(500) NULL,
  at DATETIME2(0) NOT NULL CONSTRAINT DF_audit_at DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_audit_org_time ON stride.audit_log(org_id, at DESC);
GO

-- Row-level security. The API sets the organisation for the connection before any query
-- (withOrg in apps/api/src/lib/db.ts). With no context set, every predicate returns no rows, so
-- a bug fails closed.
IF SCHEMA_ID(N'security') IS NULL EXEC (N'CREATE SCHEMA security');
GO

CREATE FUNCTION security.fn_org_predicate(@org_id UNIQUEIDENTIFIER)
RETURNS TABLE WITH SCHEMABINDING AS
  RETURN SELECT 1 AS allowed
  WHERE @org_id = TRY_CAST(SESSION_CONTEXT(N'org_id') AS UNIQUEIDENTIFIER);
GO

-- Reading coaches: the organisation in context, or the single row of the verified identity
-- (used to resolve the coach from the token before the organisation is known).
CREATE FUNCTION security.fn_coach_read_predicate(@org_id UNIQUEIDENTIFIER, @entra_oid UNIQUEIDENTIFIER)
RETURNS TABLE WITH SCHEMABINDING AS
  RETURN SELECT 1 AS allowed
  WHERE @org_id = TRY_CAST(SESSION_CONTEXT(N'org_id') AS UNIQUEIDENTIFIER)
     OR @entra_oid = TRY_CAST(SESSION_CONTEXT(N'entra_oid') AS UNIQUEIDENTIFIER);
GO

-- Reading invites: the organisation in context, or the single invite whose token hash is in
-- context (used to accept an invite before the organisation is known).
CREATE FUNCTION security.fn_invite_read_predicate(@org_id UNIQUEIDENTIFIER, @token_hash VARBINARY(32))
RETURNS TABLE WITH SCHEMABINDING AS
  RETURN SELECT 1 AS allowed
  WHERE @org_id = TRY_CAST(SESSION_CONTEXT(N'org_id') AS UNIQUEIDENTIFIER)
     OR @token_hash = TRY_CAST(SESSION_CONTEXT(N'invite_token_hash') AS VARBINARY(32));
GO

CREATE SECURITY POLICY security.org_isolation
  ADD FILTER PREDICATE security.fn_org_predicate(id) ON stride.organisations,
  ADD BLOCK PREDICATE security.fn_org_predicate(id) ON stride.organisations AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(id) ON stride.organisations AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_coach_read_predicate(org_id, entra_oid) ON stride.coaches,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.coaches AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.coaches AFTER UPDATE,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.coaches BEFORE UPDATE,
  ADD FILTER PREDICATE security.fn_invite_read_predicate(org_id, token_hash) ON stride.invites,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.invites AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.invites AFTER UPDATE,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.invites BEFORE UPDATE,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.invites BEFORE DELETE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.athletes,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.athletes AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.athletes AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.consents,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.consents AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.consents AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.sessions,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.sessions AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.sessions AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.calibrations,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.calibrations AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.calibrations AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.clips,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.clips AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.clips AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.analyses,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.analyses AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.analyses AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.analysis_metrics,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.analysis_metrics AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.analysis_metrics AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.notes,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.notes AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.notes AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.reports,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.reports AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.reports AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.report_frames,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.report_frames AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.report_frames AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.device_checks,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.device_checks AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.device_checks AFTER UPDATE,
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.audit_log,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.audit_log AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.audit_log AFTER UPDATE
  WITH (STATE = ON);
GO

-- Deletes an athlete and everything linked to them, in an explicit order, and audits it. Runs
-- with the caller's permissions, so row-level security keeps it inside the organisation in
-- context. Blob files of uploaded clips are deleted by the API afterwards (stretch milestone).
CREATE PROCEDURE stride.delete_athlete
  @athlete_id UNIQUEIDENTIFIER,
  @coach_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @org_id UNIQUEIDENTIFIER = TRY_CAST(SESSION_CONTEXT(N'org_id') AS UNIQUEIDENTIFIER);
  IF @org_id IS NULL OR NOT EXISTS (SELECT 1 FROM stride.athletes WHERE id = @athlete_id)
  BEGIN
    SELECT CAST(0 AS BIT) AS deleted;
    RETURN;
  END;

  BEGIN TRANSACTION;
  DECLARE @reports TABLE (id UNIQUEIDENTIFIER PRIMARY KEY);
  INSERT INTO @reports (id) SELECT id FROM stride.reports WHERE athlete_id = @athlete_id;
  DECLARE @analyses TABLE (id UNIQUEIDENTIFIER PRIMARY KEY);
  INSERT INTO @analyses (id)
    SELECT id FROM stride.analyses
    WHERE athlete_id = @athlete_id
       OR clip_id IN (SELECT id FROM stride.clips WHERE athlete_id = @athlete_id);

  -- shared_reports has no row-level security, so filter by organisation explicitly.
  DELETE f FROM stride.shared_report_frames f
    JOIN stride.shared_reports s ON s.token_hash = f.token_hash
    WHERE s.org_id = @org_id AND s.report_id IN (SELECT id FROM @reports);
  DELETE FROM stride.shared_reports WHERE org_id = @org_id AND report_id IN (SELECT id FROM @reports);
  DELETE FROM stride.report_frames WHERE report_id IN (SELECT id FROM @reports);
  DELETE FROM stride.reports WHERE id IN (SELECT id FROM @reports);
  DELETE FROM stride.notes WHERE analysis_id IN (SELECT id FROM @analyses);
  DELETE FROM stride.analysis_metrics WHERE analysis_id IN (SELECT id FROM @analyses);
  DELETE FROM stride.analyses WHERE id IN (SELECT id FROM @analyses);
  DELETE FROM stride.clips WHERE athlete_id = @athlete_id;
  DELETE FROM stride.consents WHERE athlete_id = @athlete_id;
  DELETE FROM stride.athletes WHERE id = @athlete_id;
  INSERT INTO stride.audit_log (org_id, coach_id, action, target_type, target_id, detail)
    VALUES (@org_id, @coach_id, 'athlete.delete', 'athlete', @athlete_id,
            CONCAT('reports=', (SELECT COUNT(*) FROM @reports), ' analyses=', (SELECT COUNT(*) FROM @analyses)));
  COMMIT TRANSACTION;
  SELECT CAST(1 AS BIT) AS deleted;
END;
GO

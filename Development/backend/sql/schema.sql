-- ═══════════════════════════════════════
-- William Database Schema (MySQL 8+)
-- ═══════════════════════════════════════

CREATE DATABASE IF NOT EXISTS william_app
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE william_app;

-- ── Users ──
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  name        VARCHAR(100) NOT NULL DEFAULT '',
  age         TINYINT UNSIGNED,
  bio         TEXT,
  avatar_color VARCHAR(7) DEFAULT '#8B7FCC',
  challenges  JSON,
  sleep       TINYINT UNSIGNED,
  work        TINYINT UNSIGNED,
  trigs       JSON,
  voice_mode  VARCHAR(20) DEFAULT 'classic',
  language    VARCHAR(10) DEFAULT 'zh-CN',
  memory_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ambient_asr_enabled TINYINT(1) NOT NULL DEFAULT 1,
  story_openai_api_key TEXT,
  archetype   VARCHAR(20) DEFAULT 'reflector',
  xp          INT UNSIGNED DEFAULT 0,
  streak      INT UNSIGNED DEFAULT 0,
  days_used   INT UNSIGNED DEFAULT 0,
  active_path TINYINT UNSIGNED,
  path_step   TINYINT UNSIGNED DEFAULT 0,
  perms       JSON,
  push_token  VARCHAR(255),
  onboarded   TINYINT(1) DEFAULT 0,
  chat_last_cleared_at TIMESTAMP NULL DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_last_active (last_active)
) ENGINE=InnoDB;

-- ── Chat sessions ──
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  session_key VARCHAR(50) NOT NULL,
  is_temporary TINYINT(1) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_session (user_id, session_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Chat messages ──
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id  BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  role        ENUM('user','assistant') NOT NULL,
  content     TEXT NOT NULL,
  attachments JSON,
  analysis    JSON,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id),
  INDEX idx_user_time (user_id, created_at),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Chat attachments ──
CREATE TABLE IF NOT EXISTS chat_attachments (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id     BIGINT UNSIGNED NOT NULL,
  session_id     BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  kind           ENUM('image','document','audio','other') NOT NULL DEFAULT 'other',
  status         ENUM('uploaded','processing','ready','failed') NOT NULL DEFAULT 'uploaded',
  original_name  VARCHAR(255) NOT NULL,
  storage_path   VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(120) NOT NULL,
  size_bytes     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  extracted_text MEDIUMTEXT,
  summary        TEXT,
  ocr_text       MEDIUMTEXT,
  memory_facts   JSON,
  meta_json      JSON,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_attachment_message (message_id),
  INDEX idx_attachment_session_time (session_id, created_at),
  INDEX idx_attachment_user_status (user_id, status, updated_at),
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Session memories ──
CREATE TABLE IF NOT EXISTS session_memories (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  scope           ENUM('shared_session','classic_bias','expert_bias') NOT NULL,
  summary         TEXT NOT NULL,
  key_topics      JSON,
  open_loops      JSON,
  last_message_id BIGINT UNSIGNED,
  message_count   INT UNSIGNED DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_session_scope (session_id, scope),
  INDEX idx_user_scope (user_id, scope),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── User memories ──
CREATE TABLE IF NOT EXISTS user_memories (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL,
  scope             ENUM('shared_core','classic_bias','expert_bias') NOT NULL,
  memory_type       VARCHAR(32) NOT NULL,
  content           TEXT NOT NULL,
  canonical_key     VARCHAR(160),
  confidence        DECIMAL(4,2) DEFAULT 0.50,
  status            ENUM('active','suppressed','deleted') DEFAULT 'active',
  times_seen        INT UNSIGNED DEFAULT 1,
  source_message_id BIGINT UNSIGNED,
  source_session_id BIGINT UNSIGNED,
  is_user_confirmed TINYINT(1) DEFAULT 0,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_used_at      TIMESTAMP NULL DEFAULT NULL,
  last_confirmed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_memory_scope (user_id, scope, memory_type),
  INDEX idx_user_memory_lookup (user_id, scope, memory_type, canonical_key),
  INDEX idx_user_memory_status (user_id, status, updated_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Memory events ──
CREATE TABLE IF NOT EXISTS memory_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  session_id  BIGINT UNSIGNED NOT NULL,
  message_id  BIGINT UNSIGNED,
  event_type  VARCHAR(32) NOT NULL,
  rule_name   VARCHAR(64),
  before_value TEXT,
  after_value TEXT,
  payload     JSON,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_event_time (user_id, created_at),
  INDEX idx_session_event_time (session_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── User active loops ──
CREATE TABLE IF NOT EXISTS user_active_loops (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL,
  loop_type         VARCHAR(32) NOT NULL,
  title             VARCHAR(160) NOT NULL,
  summary           TEXT,
  canonical_key     VARCHAR(160),
  keywords          JSON,
  confidence        DECIMAL(4,2) DEFAULT 0.60,
  status            ENUM('active','resolved','dismissed') DEFAULT 'active',
  times_seen        INT UNSIGNED DEFAULT 1,
  source_message_id BIGINT UNSIGNED,
  source_session_id BIGINT UNSIGNED,
  due_hint          VARCHAR(80),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_seen_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_loop_status (user_id, status, updated_at),
  INDEX idx_user_loop_lookup (user_id, status, loop_type, canonical_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Intervention outcomes ──
CREATE TABLE IF NOT EXISTS intervention_outcomes (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id             BIGINT UNSIGNED NOT NULL,
  session_id          BIGINT UNSIGNED NOT NULL,
  user_message_id     BIGINT UNSIGNED NULL,
  assistant_message_id BIGINT UNSIGNED NULL,
  intervention_type   VARCHAR(48) NOT NULL,
  suggestion_summary  VARCHAR(220) NOT NULL,
  target_loop_id      BIGINT UNSIGNED NULL,
  target_memory_id    BIGINT UNSIGNED NULL,
  accepted_signal     ENUM('none','explicit_accept','explicit_reject','behavior_followthrough') NOT NULL DEFAULT 'none',
  followup_signal     VARCHAR(64) NULL,
  self_report_delta   DECIMAL(5,2) NULL,
  stress_delta_window DECIMAL(5,2) NULL,
  outcome_score       DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  status              ENUM('pending','observed','ineffective') NOT NULL DEFAULT 'pending',
  meta_json           JSON,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_intervention_time (user_id, created_at),
  INDEX idx_user_intervention_type (user_id, intervention_type, updated_at),
  INDEX idx_user_intervention_status (user_id, status, updated_at),
  INDEX idx_session_intervention (session_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── User intervention preferences ──
CREATE TABLE IF NOT EXISTS user_intervention_preferences (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id             BIGINT UNSIGNED NOT NULL,
  intervention_type   VARCHAR(48) NOT NULL,
  evidence_count      INT UNSIGNED NOT NULL DEFAULT 0,
  positive_count      INT UNSIGNED NOT NULL DEFAULT 0,
  negative_count      INT UNSIGNED NOT NULL DEFAULT 0,
  acceptance_count    INT UNSIGNED NOT NULL DEFAULT 0,
  followthrough_count INT UNSIGNED NOT NULL DEFAULT 0,
  avg_outcome_score   DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  effectiveness_label ENUM('helpful','mixed','avoid','unknown') NOT NULL DEFAULT 'unknown',
  summary             VARCHAR(220) NULL,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_intervention_type (user_id, intervention_type),
  INDEX idx_user_effectiveness (user_id, effectiveness_label, avg_outcome_score),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Mood entries ──
CREATE TABLE IF NOT EXISTS moods (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  mood        TINYINT UNSIGNED NOT NULL COMMENT '0=great, 4=anxious',
  stress      TINYINT UNSIGNED NOT NULL COMMENT '1-10',
  note        TEXT,
  note_analysis JSON,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Journal entries ──
CREATE TABLE IF NOT EXISTS journals (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  entry_date    DATE NOT NULL,
  text_content  TEXT NOT NULL,
  analysis      JSON,
  deep_analysis JSON,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_entry_date (user_id, entry_date),
  INDEX idx_user_entry_date (user_id, entry_date),
  INDEX idx_user_time (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS journal_attachments (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  journal_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  entry_date      DATE NOT NULL,
  kind            ENUM('image','document','audio','video','other') NOT NULL DEFAULT 'other',
  status          ENUM('uploaded','processing','ready','failed') NOT NULL DEFAULT 'uploaded',
  original_name   VARCHAR(255) NOT NULL,
  storage_path    VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(120) NOT NULL,
  size_bytes      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  extracted_text  MEDIUMTEXT,
  summary         TEXT,
  ocr_text        MEDIUMTEXT,
  memory_facts    JSON,
  meta_json       JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_journal_attachment_journal (journal_id, created_at),
  INDEX idx_journal_attachment_user_date (user_id, entry_date, created_at),
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Day profiles (behavioral graph) ──
CREATE TABLE IF NOT EXISTS day_profiles (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  date            DATE NOT NULL,
  day_of_week     VARCHAR(10),
  composite_stress DECIMAL(4,2),
  composite_mood   DECIMAL(4,2),
  chat_stress     DECIMAL(4,2),
  chat_peak       DECIMAL(4,2),
  ambient_stress_avg DECIMAL(4,2),
  ambient_stress_peak DECIMAL(4,2),
  ambient_listening_count INT UNSIGNED DEFAULT 0,
  ambient_transcript_tokens INT UNSIGNED DEFAULT 0,
  chat_emotions   JSON,
  chat_topics     JSON,
  chat_patterns   JSON,
  chat_engagement INT UNSIGNED DEFAULT 0,
  chat_count      INT UNSIGNED DEFAULT 0,
  mood_avg        DECIMAL(4,2),
  stress_avg      DECIMAL(4,2),
  stress_peak     DECIMAL(4,2),
  journal_topics  JSON,
  journal_patterns JSON,
  practice_count  TINYINT UNSIGNED DEFAULT 0,
  practices_done  JSON,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_date (user_id, date),
  INDEX idx_user_date (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Ambient listening events ──
CREATE TABLE IF NOT EXISTS ambient_listening_events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  transcript      TEXT NULL,
  transcript_hash CHAR(40) NULL,
  event_hash      CHAR(40) NOT NULL,
  token_count     INT UNSIGNED DEFAULT 0,
  analysis_json   JSON,
  source_page     VARCHAR(40),
  source_session_key VARCHAR(80),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ambient_user_time (user_id, created_at),
  INDEX idx_ambient_hash (user_id, transcript_hash),
  INDEX idx_ambient_event_hash (user_id, event_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Badges ──
CREATE TABLE IF NOT EXISTS badges (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id   BIGINT UNSIGNED NOT NULL,
  badge_id  VARCHAR(30) NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_badge (user_id, badge_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Journey enrollments ──
CREATE TABLE IF NOT EXISTS journey_enrollments (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  journey_id   VARCHAR(30) NOT NULL,
  current_step TINYINT UNSIGNED DEFAULT 0,
  started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uk_user_journey (user_id, journey_id),
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Schedule candidates from William chat ──
CREATE TABLE IF NOT EXISTS schedule_candidates (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL,
  session_id        BIGINT UNSIGNED NOT NULL,
  source_message_id BIGINT UNSIGNED NOT NULL,
  title             VARCHAR(255) NOT NULL,
  start_time        DATETIME NULL,
  end_time          DATETIME NULL,
  date_text         VARCHAR(120),
  location          VARCHAR(160),
  participants_json JSON,
  confidence        DECIMAL(4,2) NOT NULL DEFAULT 0.50,
  status            ENUM('candidate','confirmed','dismissed','edited') NOT NULL DEFAULT 'candidate',
  dedupe_key        VARCHAR(255) NOT NULL,
  meta_json         JSON,
  todo_status       ENUM('pending','completed') NOT NULL DEFAULT 'pending',
  todo_completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  confirmed_at      TIMESTAMP NULL DEFAULT NULL,
  dismissed_at      TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_schedule_user_status (user_id, status, updated_at),
  INDEX idx_schedule_session_status (session_id, status, updated_at),
  INDEX idx_schedule_message (source_message_id),
  INDEX idx_schedule_dedupe (user_id, dedupe_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Practice completions ──
CREATE TABLE IF NOT EXISTS practice_completions (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  practice_id  VARCHAR(80) NOT NULL,
  source_type  ENUM('manual_schedule','ai_suggestion','path_task') NOT NULL DEFAULT 'ai_suggestion',
  source_ref_id BIGINT UNSIGNED,
  time_slot    VARCHAR(10),
  xp_awarded   TINYINT UNSIGNED DEFAULT 15,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, completed_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Journey reflection entries ──
CREATE TABLE IF NOT EXISTS journey_reflection_entries (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  title      VARCHAR(160),
  status     ENUM('draft','completed') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_reflection_range (user_id, start_date, end_date),
  INDEX idx_user_reflection_range (user_id, start_date, end_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Journey reflection answers ──
CREATE TABLE IF NOT EXISTS journey_reflection_answers (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entry_id        BIGINT UNSIGNED NOT NULL,
  question_index  TINYINT UNSIGNED NOT NULL,
  question_text   TEXT NOT NULL,
  answer_text     TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reflection_question (entry_id, question_index),
  INDEX idx_reflection_entry (entry_id, question_index),
  FOREIGN KEY (entry_id) REFERENCES journey_reflection_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Proactive outreach log ──
CREATE TABLE IF NOT EXISTS outreach (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  reasons     JSON,
  urgency     TINYINT UNSIGNED,
  message     TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Daily narrative stories (叙事故事卡) ──
CREATE TABLE IF NOT EXISTS daily_stories (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  date_key   VARCHAR(10) NOT NULL COMMENT 'YYYY-MM-DD',
  panels     JSON COMMENT '4-panel story: [{type, title, text, signal_source}]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_date_story (user_id, date_key),
  INDEX idx_daily_story_user_date (user_id, date_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Pattern milestones (模式里程碑) ──
CREATE TABLE IF NOT EXISTS pattern_milestones (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  milestone_type VARCHAR(50) NOT NULL COMMENT 'e.g. cycle_breaker, deep_awareness',
  title          VARCHAR(120),
  description    TEXT,
  evidence_json  JSON COMMENT 'Which days/events triggered this milestone',
  achieved_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_milestone (user_id, milestone_type),
  INDEX idx_pattern_milestones_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Journey path definitions ──
CREATE TABLE IF NOT EXISTS journey_paths (
  id          VARCHAR(30) NOT NULL PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  parts       TINYINT UNSIGNED NOT NULL DEFAULT 6,
  icon        VARCHAR(10) NOT NULL DEFAULT '🧠',
  gradient    JSON NOT NULL COMMENT '[color1, color2]',
  steps       JSON NOT NULL COMMENT '[{t: string, p: string}]',
  sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- ── Monthly recovery path templates ──
CREATE TABLE IF NOT EXISTS recovery_path_templates (
  id            VARCHAR(40) NOT NULL PRIMARY KEY,
  badge_id      VARCHAR(40) NOT NULL,
  title         VARCHAR(120) NOT NULL,
  summary       TEXT NOT NULL,
  default_tasks JSON NOT NULL COMMENT '[{title, description, kind, actionPrompt, dayOffset}]',
  icon          VARCHAR(10) NOT NULL DEFAULT '🧭',
  gradient      JSON NOT NULL COMMENT '[color1, color2]',
  sort_order    TINYINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- ── User monthly recovery paths ──
CREATE TABLE IF NOT EXISTS user_recovery_paths (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  template_id    VARCHAR(40) NOT NULL,
  month_start    DATE NOT NULL,
  title          VARCHAR(120) NOT NULL,
  summary        TEXT NOT NULL,
  stress_source  VARCHAR(160) NOT NULL,
  badge_id       VARCHAR(40) NOT NULL,
  generation_source ENUM('monthly_planner','daily_ai_review') NOT NULL DEFAULT 'monthly_planner',
  origin_review_id BIGINT UNSIGNED NULL,
  review_reason  TEXT NULL,
  status         ENUM('active','completed') NOT NULL DEFAULT 'active',
  icon           VARCHAR(10) NOT NULL DEFAULT '🧭',
  gradient_json  JSON NOT NULL,
  completed_at   TIMESTAMP NULL DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_month_template (user_id, month_start, template_id),
  INDEX idx_recovery_path_user_month (user_id, month_start, status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Daily AI path reviews and Today banner source ──
CREATE TABLE IF NOT EXISTS daily_ai_path_reviews (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  review_date        DATE NOT NULL,
  status             ENUM('skipped','generated') NOT NULL DEFAULT 'skipped',
  review_summary     TEXT,
  signals_json       JSON,
  generated_path_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  banner_title       VARCHAR(160),
  banner_body        TEXT,
  cta_label          VARCHAR(80),
  cta_path           VARCHAR(160),
  related_path_id    BIGINT UNSIGNED NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_review_date (user_id, review_date),
  INDEX idx_review_user_date (user_id, review_date, status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Daily tasks generated from monthly recovery paths ──
CREATE TABLE IF NOT EXISTS recovery_path_tasks (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  user_path_id    BIGINT UNSIGNED NOT NULL,
  task_date       DATE NOT NULL,
  task_kind       VARCHAR(40) NOT NULL,
  title           VARCHAR(140) NOT NULL,
  description     TEXT NOT NULL,
  action_prompt   TEXT,
  sort_order      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('pending','completed') NOT NULL DEFAULT 'pending',
  completed_at    TIMESTAMP NULL DEFAULT NULL,
  metadata_json   JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_recovery_task_user_date (user_id, task_date, status),
  INDEX idx_recovery_task_path (user_path_id, task_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_path_id) REFERENCES user_recovery_paths(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── AI suggested daily practices woven into today's agenda ──
CREATE TABLE IF NOT EXISTS ai_practice_suggestions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  suggestion_date DATE NOT NULL,
  title           VARCHAR(140) NOT NULL,
  description     TEXT NOT NULL,
  suggestion_type VARCHAR(40) NOT NULL,
  trigger_label   VARCHAR(160),
  recommended_time VARCHAR(40),
  action_prompt   TEXT,
  status          ENUM('pending','completed') NOT NULL DEFAULT 'pending',
  completed_at    TIMESTAMP NULL DEFAULT NULL,
  metadata_json   JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ai_suggestion_user_date (user_id, suggestion_date, status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Practice definitions ──
CREATE TABLE IF NOT EXISTS practices (
  id          VARCHAR(30) NOT NULL PRIMARY KEY,
  slot        ENUM('morning','midday','evening') NOT NULL,
  icon        VARCHAR(10) NOT NULL,
  name        VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  type        VARCHAR(40) NOT NULL,
  mins        TINYINT UNSIGNED NOT NULL DEFAULT 3,
  sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_practices_slot (slot)
) ENGINE=InnoDB;

-- ── Password reset tokens ──
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  token       VARCHAR(6) NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  used        TINYINT(1) DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_token (email, token),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB;

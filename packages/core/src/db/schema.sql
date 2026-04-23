CREATE TABLE IF NOT EXISTS platforms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS field_mappings (
    id              TEXT PRIMARY KEY,
    platform_id     TEXT NOT NULL REFERENCES platforms(id),
    entity_type     TEXT NOT NULL CHECK(entity_type IN ('post','comment','user')),
    system_field    TEXT NOT NULL,
    platform_field  TEXT NOT NULL,
    data_type       TEXT NOT NULL CHECK(data_type IN ('string','number','date','boolean','array','json')),
    is_required     BOOLEAN DEFAULT false,
    transform_expr  TEXT,
    description     TEXT,
    UNIQUE(platform_id, entity_type, system_field)
);

CREATE TABLE IF NOT EXISTS posts (
    id                  TEXT PRIMARY KEY,
    platform_id         TEXT NOT NULL REFERENCES platforms(id),
    platform_post_id    TEXT NOT NULL,
    title               TEXT,
    content             TEXT NOT NULL,
    author_id           TEXT,
    author_name         TEXT,
    author_url          TEXT,
    url                 TEXT,
    cover_url           TEXT,
    post_type           TEXT,
    like_count          INTEGER DEFAULT 0,
    collect_count       INTEGER DEFAULT 0,
    comment_count       INTEGER DEFAULT 0,
    share_count         INTEGER DEFAULT 0,
    play_count          INTEGER DEFAULT 0,
    score               INTEGER,
    tags                JSON,
    media_files         JSON,
    published_at        TIMESTAMP,
    fetched_at          TIMESTAMP DEFAULT NOW(),
    metadata            JSON,
    UNIQUE(platform_id, platform_post_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id                  TEXT PRIMARY KEY,
    post_id             TEXT NOT NULL REFERENCES posts(id),
    platform_id         TEXT NOT NULL REFERENCES platforms(id),
    platform_comment_id TEXT,
    parent_comment_id   TEXT,
    root_comment_id     TEXT,
    depth               INTEGER DEFAULT 0,
    author_id           TEXT,
    author_name         TEXT,
    content             TEXT NOT NULL,
    like_count          INTEGER DEFAULT 0,
    reply_count         INTEGER DEFAULT 0,
    published_at        TIMESTAMP,
    fetched_at          TIMESTAMP DEFAULT NOW(),
    metadata            JSON
);

CREATE TABLE IF NOT EXISTS media_files (
    id              TEXT PRIMARY KEY,
    post_id         TEXT REFERENCES posts(id),
    comment_id      TEXT REFERENCES comments(id),
    platform_id     TEXT REFERENCES platforms(id),
    media_type      TEXT NOT NULL,
    url             TEXT NOT NULL,
    local_path      TEXT,
    width           INTEGER,
    height          INTEGER,
    duration_ms     INTEGER,
    file_size       INTEGER,
    downloaded_at   TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    template    TEXT NOT NULL,
    is_default  BOOLEAN DEFAULT false,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    template_id TEXT REFERENCES prompt_templates(id),
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed')),
    stats       JSON,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- tasks.cli_templates: JSON string of opencli command templates
-- ALTER TABLE tasks ADD COLUMN cli_templates TEXT;

CREATE TABLE IF NOT EXISTS task_targets (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
    target_id   TEXT NOT NULL,
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
    error       TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS analysis_results_comments (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    comment_id      TEXT NOT NULL REFERENCES comments(id),
    sentiment_label TEXT,
    sentiment_score DOUBLE,
    intent          TEXT,
    risk_flagged    BOOLEAN DEFAULT false,
    risk_level      TEXT,
    risk_reason     TEXT,
    topics          JSON,
    emotion_tags    JSON,
    keywords        JSON,
    summary         TEXT,
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_results_media (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    media_id        TEXT NOT NULL REFERENCES media_files(id),
    media_type      TEXT NOT NULL,
    content_type    TEXT,
    description     TEXT,
    ocr_text        TEXT,
    sentiment_label TEXT,
    sentiment_score DOUBLE,
    risk_flagged    BOOLEAN DEFAULT false,
    risk_level      TEXT,
    risk_reason     TEXT,
    objects         JSON,
    logos           JSON,
    faces           JSON,
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_jobs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    strategy_id     TEXT,
    target_type     TEXT,
    target_id       TEXT,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','waiting_media','processing','completed','failed')),
    priority        INTEGER DEFAULT 0,
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    processed_at    TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_post_status (
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  post_id         TEXT NOT NULL,
  comments_fetched BOOLEAN DEFAULT FALSE,
  media_fetched   BOOLEAN DEFAULT FALSE,
  comments_count  INTEGER DEFAULT 0,
  media_count     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','fetching','done','failed')),
  error           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (task_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_task_post_status_task ON task_post_status(task_id);

CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_platform ON comments(platform_id);
CREATE INDEX IF NOT EXISTS idx_task_targets_task ON task_targets(task_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_comments_task ON analysis_results_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_comments_sentiment ON analysis_results_comments(sentiment_label);
CREATE INDEX IF NOT EXISTS idx_analysis_results_media_task ON analysis_results_media(task_id);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status);

CREATE TABLE IF NOT EXISTS strategies (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    version         TEXT NOT NULL DEFAULT '1.0.0',
    target          TEXT NOT NULL CHECK(target IN ('post', 'comment')),
    needs_media     JSON,
    prompt          TEXT NOT NULL,
    output_schema   JSON NOT NULL,
    batch_config    JSON,
    depends_on      TEXT,
    include_original BOOLEAN DEFAULT false,
    file_path       TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_steps (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id),
    depends_on_step_id TEXT,
    name            TEXT NOT NULL,
    step_order      INTEGER NOT NULL DEFAULT 0,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
    stats           JSON,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);


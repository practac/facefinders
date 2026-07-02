import json
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "storage" / "mvp.sqlite3"


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                source_url TEXT,
                home_team TEXT NOT NULL,
                away_team TEXT NOT NULL,
                stadium TEXT NOT NULL,
                broadcast TEXT NOT NULL,
                game_date TEXT NOT NULL,
                processing_status TEXT NOT NULL,
                frames_extracted INTEGER NOT NULL,
                frames_skipped INTEGER NOT NULL,
                faces_detected INTEGER NOT NULL,
                embeddings_indexed INTEGER NOT NULL,
                shots_detected INTEGER NOT NULL,
                skip_rate INTEGER NOT NULL,
                crowd_score INTEGER NOT NULL,
                faiss_ready INTEGER NOT NULL,
                hero_gradient TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS face_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_name TEXT NOT NULL,
                filename TEXT NOT NULL,
                quality_score INTEGER NOT NULL,
                embedding_ref TEXT NOT NULL,
                consent_status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS search_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id INTEGER NOT NULL,
                face_profile_id INTEGER NOT NULL,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                is_paid INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS search_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                search_id INTEGER NOT NULL,
                scene_type TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                similarity INTEGER NOT NULL,
                confidence TEXT NOT NULL,
                gradient TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                search_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                amount INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                placement TEXT NOT NULL,
                target_url TEXT NOT NULL,
                cta TEXT NOT NULL,
                impressions INTEGER NOT NULL,
                clicks INTEGER NOT NULL,
                ctr INTEGER NOT NULL,
                status TEXT NOT NULL
            );
            """
        )
        existing_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(search_results)").fetchall()
        }
        if "bbox_json" not in existing_columns:
            conn.execute("ALTER TABLE search_results ADD COLUMN bbox_json TEXT")
        if "timestamp_seconds" not in existing_columns:
            conn.execute("ALTER TABLE search_results ADD COLUMN timestamp_seconds INTEGER")
        if "det_score" not in existing_columns:
            conn.execute("ALTER TABLE search_results ADD COLUMN det_score REAL")
        if "crop_path" not in existing_columns:
            conn.execute("ALTER TABLE search_results ADD COLUMN crop_path TEXT")


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def as_json(value):
    return json.dumps(value, ensure_ascii=False)

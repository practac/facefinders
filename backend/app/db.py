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
        seed(conn)


def seed(conn):
    video_count = conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
    if video_count == 0:
        videos = [
            (
                "LG vs KIA 9회말 응원전",
                "https://youtube.com/watch?v=demo-lg-kia",
                "LG",
                "KIA",
                "잠실야구장",
                "KBO 중계",
                "2026-06-21",
                "analysis_ready",
                1842,
                1180,
                426,
                193,
                214,
                64,
                92,
                1,
                "linear-gradient(135deg, #0b8f68, #1d7cff)",
            ),
            (
                "두산 vs 삼성 홈런 직후 관중석",
                "https://youtube.com/watch?v=demo-doosan-samsung",
                "두산",
                "삼성",
                "잠실야구장",
                "스포츠 채널",
                "2026-06-14",
                "analysis_ready",
                1560,
                902,
                388,
                171,
                188,
                58,
                88,
                1,
                "linear-gradient(135deg, #123b73, #e5a928)",
            ),
            (
                "롯데 vs 한화 경기 시작 관중 클로즈업",
                "https://youtube.com/watch?v=demo-lotte-hanwha",
                "롯데",
                "한화",
                "사직야구장",
                "KBO 중계",
                "2026-06-07",
                "indexing",
                980,
                510,
                241,
                84,
                122,
                52,
                81,
                0,
                "linear-gradient(135deg, #d8342a, #23315f)",
            ),
        ]
        conn.executemany(
            """
            INSERT INTO videos (
                title, source_url, home_team, away_team, stadium, broadcast, game_date,
                processing_status, frames_extracted, frames_skipped, faces_detected,
                embeddings_indexed, shots_detected, skip_rate, crowd_score, faiss_ready,
                hero_gradient
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            videos,
        )

    ad_count = conn.execute("SELECT COUNT(*) FROM ads").fetchone()[0]
    if ad_count == 0:
        ads = [
            ("페이스 인증 제휴 캠페인", "홈 상단", "https://example.com/facepay", "혜택 보기", 12840, 462, 4, "approved"),
            ("구단 멤버십 시즌 패스", "분석 대기 화면", "https://example.com/season", "가입하기", 8422, 318, 4, "approved"),
        ]
        conn.executemany(
            "INSERT INTO ads (title, placement, target_url, cta, impressions, clicks, ctr, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ads,
        )


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def as_json(value):
    return json.dumps(value, ensure_ascii=False)

import hashlib
import random
import shutil
from datetime import datetime
from pathlib import Path

from app.db import BASE_DIR, connect, row_to_dict, rows_to_dicts
from app.services.face_model import infer_or_fallback

INDEX_DIR = BASE_DIR / "indexes"
UPLOAD_DIR = BASE_DIR / "uploads"


def has_real_runtime():
    checks = {
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "opencv": False,
        "faiss": False,
        "insightface": False,
        "onnxruntime": False,
    }
    try:
        import cv2  # noqa: F401

        checks["opencv"] = True
    except Exception:
        pass
    try:
        import faiss  # noqa: F401

        checks["faiss"] = True
    except Exception:
        pass
    try:
        import insightface  # noqa: F401

        checks["insightface"] = True
    except Exception:
        pass
    try:
        import onnxruntime  # noqa: F401

        checks["onnxruntime"] = True
    except Exception:
        pass
    return checks


def deterministic_embedding_ref(payload: bytes) -> str:
    digest = hashlib.sha256(payload).hexdigest()
    return f"emb_{digest[:24]}"


def process_video(video_id: int):
    runtime = has_real_runtime()
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    real_mode = all(runtime.values())

    random.seed(video_id)
    frames = random.randint(1400, 2200)
    skipped = random.randint(760, 1420)
    faces = random.randint(260, 620)
    embeddings = max(60, int(faces * random.uniform(0.36, 0.52)))
    shots = random.randint(150, 260)
    skip_rate = min(82, int(skipped / frames * 100))
    crowd_score = random.randint(78, 96)

    index_path = INDEX_DIR / f"video_{video_id}.faiss"
    index_path.write_text(
        "real_runtime=" + str(real_mode) + "\n"
        + "ffmpeg=" + str(runtime["ffmpeg"]) + "\n"
        + "opencv=" + str(runtime["opencv"]) + "\n"
        + "faiss=" + str(runtime["faiss"]) + "\n",
        encoding="utf-8",
    )

    with connect() as conn:
        conn.execute(
            """
            UPDATE videos
            SET processing_status = ?, frames_extracted = ?, frames_skipped = ?,
                faces_detected = ?, embeddings_indexed = ?, shots_detected = ?,
                skip_rate = ?, crowd_score = ?, faiss_ready = ?
            WHERE id = ?
            """,
            (
                "analysis_ready",
                frames,
                skipped,
                faces,
                embeddings,
                shots,
                skip_rate,
                crowd_score,
                1,
                video_id,
            ),
        )
        video = row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone())
    return {**video, "runtime": runtime, "real_mode": real_mode}


def save_face_upload(file_bytes: bytes, filename: str, owner_name: str):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = filename.replace("/", "_").replace("\\", "_") or "face.jpg"
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    stored_name = f"{stamp}_{safe_name}"
    (UPLOAD_DIR / stored_name).write_bytes(file_bytes)

    inference = infer_or_fallback(file_bytes, stored_name)
    quality = inference["quality_score"]
    embedding_ref = inference["embedding_ref"]
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO face_profiles (
                owner_name, filename, quality_score, embedding_ref, consent_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (owner_name, stored_name, quality, embedding_ref, "accepted", datetime.utcnow().isoformat()),
        )
        profile = row_to_dict(conn.execute("SELECT * FROM face_profiles WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return {**profile, **inference}


def create_search(video_id: int, face_profile_id: int, mode: str):
    with connect() as conn:
        video = row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone())
        if not video:
            raise ValueError("video_not_found")
        if not video["faiss_ready"]:
            process_video(video_id)

    random.seed(video_id * 1000 + face_profile_id)
    candidates = [
        ("홈런 직후 관중 응원", "01:12:30", "01:12:38", random.randint(78, 91), "높음", "linear-gradient(135deg, #f6c84c, #0b8f68)"),
        ("경기 시작 관중 클로즈업", "00:04:18", "00:04:24", random.randint(68, 84), "보통", "linear-gradient(135deg, #1d7cff, #081d38)"),
        ("이닝 교대 응원석", "00:48:05", "00:48:12", random.randint(60, 77), "보통", "linear-gradient(135deg, #bf2744, #162f48)"),
    ]

    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO search_requests (video_id, face_profile_id, mode, status, is_paid, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (video_id, face_profile_id, mode, "result_ready", 1, datetime.utcnow().isoformat()),
        )
        search_id = cursor.lastrowid
        conn.executemany(
            """
            INSERT INTO search_results (
                search_id, scene_type, start_time, end_time, similarity, confidence, gradient
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [(search_id, *candidate) for candidate in candidates],
        )
    return get_search(search_id)


def get_search(search_id: int):
    with connect() as conn:
        search = row_to_dict(conn.execute("SELECT * FROM search_requests WHERE id = ?", (search_id,)).fetchone())
        if not search:
            return None
        matches = rows_to_dicts(conn.execute("SELECT * FROM search_results WHERE search_id = ?", (search_id,)).fetchall())
    search["is_paid"] = bool(search["is_paid"])
    search["matches"] = matches
    return search


def mark_paid(search_id: int, product_name: str, amount: int):
    with connect() as conn:
        conn.execute("UPDATE search_requests SET is_paid = 1 WHERE id = ?", (search_id,))
        cursor = conn.execute(
            """
            INSERT INTO payments (search_id, product_name, amount, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (search_id, product_name, amount, "paid", datetime.utcnow().isoformat()),
        )
        payment = row_to_dict(conn.execute("SELECT * FROM payments WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return payment

import json
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

from app.db import BASE_DIR, connect, row_to_dict, rows_to_dicts
from app.services.face_model import EMBEDDING_DIR, FaceInferenceError, get_face_app, infer_or_fallback

INDEX_DIR = BASE_DIR / "indexes"
UPLOAD_DIR = BASE_DIR / "uploads"
VIDEO_DIR = BASE_DIR / "videos"
CROP_DIR = BASE_DIR / "crops"
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
REMOTE_VIDEO_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
REMOTE_SAMPLE_SECONDS = 1.0
REMOTE_MAX_SAMPLES = 360
LOCAL_SAMPLE_SECONDS = 2.0
LOCAL_MAX_SAMPLES = 180


def has_real_runtime():
    ffmpeg_path = find_ffmpeg()
    checks = {
        "ffmpeg": ffmpeg_path is not None,
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


def find_ffmpeg():
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def save_video_upload(file_bytes: bytes, filename: str) -> str:
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = filename.replace("/", "_").replace("\\", "_") or "video.mp4"
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    stored_name = f"{stamp}_{safe_name}"
    path = VIDEO_DIR / stored_name
    path.write_bytes(file_bytes)
    return str(path)


def is_remote_url(value: str) -> bool:
    parsed = urlparse(value or "")
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def is_supported_video_url(value: str) -> bool:
    parsed = urlparse(value or "")
    host = parsed.netloc.lower()
    return parsed.scheme in {"http", "https"} and host in REMOTE_VIDEO_HOSTS


def download_remote_video(video_id: int, source_url: str) -> Path:
    if not is_supported_video_url(source_url):
        raise ValueError("현재는 youtube.com 또는 youtu.be 링크만 지원합니다.")

    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError("yt-dlp가 설치되어 있지 않아 유튜브 영상을 가져올 수 없습니다.") from exc

    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    output_template = str(VIDEO_DIR / f"{stamp}_youtube_{video_id}_%(id)s.%(ext)s")
    options = {
        "format": "best[ext=mp4][height<=480]/best[height<=480]/bv*[ext=mp4][height<=480]/bv*[height<=480]/worst",
        "noplaylist": True,
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "fragment_retries": 3,
    }
    ffmpeg_path = find_ffmpeg()
    if ffmpeg_path:
        options["ffmpeg_location"] = str(Path(ffmpeg_path).parent)

    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(source_url, download=True)
        downloaded = Path(downloader.prepare_filename(info))

    if not downloaded.exists() or not downloaded.is_file():
        candidates = sorted(VIDEO_DIR.glob(f"{stamp}_youtube_{video_id}_*"), key=lambda path: path.stat().st_mtime, reverse=True)
        if candidates:
            downloaded = candidates[0]
    if not downloaded.exists() or not downloaded.is_file():
        raise RuntimeError("유튜브 영상 다운로드 파일을 찾을 수 없습니다.")

    return downloaded


def cleanup_temp_video(source_path: Path):
    try:
        if source_path.is_file() and source_path.parent.resolve() == VIDEO_DIR.resolve():
            source_path.unlink()
    except Exception:
        pass


def save_face_crop(video_id: int, frame, bbox, timestamp_seconds: float, sequence: int) -> str | None:
    import cv2

    x1, y1, x2, y2 = [int(round(value)) for value in bbox]
    height, width = frame.shape[:2]
    pad = max(12, int(max(x2 - x1, y2 - y1) * 0.25))
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(width, x2 + pad), min(height, y2 + pad)
    if x2 <= x1 or y2 <= y1:
        return None

    crop = frame[y1:y2, x1:x2]
    ok, encoded = cv2.imencode(".jpg", crop)
    if not ok:
        return None

    CROP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = int(timestamp_seconds * 1000)
    path = CROP_DIR / f"video_{video_id}_{stamp}_{sequence}.jpg"
    path.write_bytes(encoded.tobytes())
    return str(path)


def write_faiss_index(index, index_path: Path):
    import faiss

    serialized = faiss.serialize_index(index)
    index_path.write_bytes(serialized.tobytes())


def read_faiss_index(index_path: Path):
    import faiss

    payload = np.frombuffer(index_path.read_bytes(), dtype=np.uint8)
    return faiss.deserialize_index(payload)


def process_video(video_id: int):
    runtime = has_real_runtime()
    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    with connect() as conn:
        video = row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone())
    if not video:
        raise ValueError("video_not_found")

    source_value = video["source_url"] or ""
    downloaded_remote = False
    if is_remote_url(source_value):
        try:
            source_path = download_remote_video(video_id, source_value)
            downloaded_remote = True
        except Exception as exc:
            updated = update_video_status(
                video_id,
                "download_failed",
                frames=0,
                skipped=0,
                faces=0,
                embeddings=0,
                shots=0,
                skip_rate=0,
                faiss_ready=0,
            )
            return {
                **updated,
                "runtime": runtime,
                "real_mode": False,
                "message": f"유튜브 영상을 가져오지 못했습니다: {exc}",
            }
    else:
        source_path = Path(source_value)
    if not source_path.exists() or not source_path.is_file():
        updated = update_video_status(
            video_id,
            "needs_video_file",
            frames=0,
            skipped=0,
            faces=0,
            embeddings=0,
            shots=0,
            skip_rate=0,
            faiss_ready=0,
        )
        return {
            **updated,
            "runtime": runtime,
            "real_mode": False,
            "message": "실제 영상 파일이 없어 얼굴 인덱스를 만들지 않았습니다.",
        }
    source_suffix = source_path.suffix.lower()
    if source_suffix in IMAGE_EXTENSIONS:
        try:
            return process_real_image(video_id, source_path, runtime)
        except Exception as exc:
            updated = update_video_status(
                video_id,
                "model_unavailable",
                frames=0,
                skipped=0,
                faces=0,
                embeddings=0,
                shots=0,
                skip_rate=0,
                faiss_ready=0,
            )
            return {
                **updated,
                "runtime": runtime,
                "real_mode": False,
                "message": f"실제 사진 모델 처리 실패: {exc}",
            }

    if source_suffix not in VIDEO_EXTENSIONS:
        updated = update_video_status(
            video_id,
            "invalid_video_file",
            frames=0,
            skipped=0,
            faces=0,
            embeddings=0,
            shots=0,
            skip_rate=0,
            faiss_ready=0,
        )
        return {
            **updated,
            "runtime": runtime,
            "real_mode": False,
            "message": "업로드된 파일이 영상 형식이 아니어서 얼굴 분석을 실행하지 않았습니다.",
        }

    try:
        return process_fast_video(video_id, source_path, runtime, remote_source=downloaded_remote)
    except Exception as exc:
        updated = update_video_status(
            video_id,
            "model_unavailable",
            frames=0,
            skipped=0,
            faces=0,
            embeddings=0,
            shots=0,
            skip_rate=0,
            faiss_ready=0,
        )
        return {
            **updated,
            "runtime": runtime,
            "real_mode": False,
            "message": f"실제 모델 처리 실패: {exc}",
        }


def process_fast_video(video_id: int, source_path: Path, runtime: dict, remote_source: bool = False):
    import cv2
    import faiss

    app = get_face_app()
    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        if remote_source:
            cleanup_temp_video(source_path)
        raise FaceInferenceError("video_open_failed")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        sample_seconds = REMOTE_SAMPLE_SECONDS if remote_source else LOCAL_SAMPLE_SECONDS
        sample_every_frames = max(1, int(fps * sample_seconds))
        max_samples = REMOTE_MAX_SAMPLES if remote_source else LOCAL_MAX_SAMPLES

        embeddings = []
        metadata = []
        sampled_frames = 0
        face_count = 0
        frame_index = 0
        crop_sequence = 0

        while sampled_frames < max_samples and (not total_frames or frame_index < total_frames):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                break

            timestamp_seconds = frame_index / fps
            sampled_frames += 1
            faces = app.get(frame)
            if not faces:
                frame_index += sample_every_frames
                continue

            for face in faces:
                vector = np.asarray(face.embedding, dtype=np.float32)
                norm = np.linalg.norm(vector)
                if norm:
                    vector = vector / norm
                embeddings.append(vector)
                face_count += 1

                bbox = [float(value) for value in face.bbox.tolist()]
                crop_path = save_face_crop(video_id, frame, bbox, timestamp_seconds, crop_sequence)
                crop_sequence += 1
                metadata.append(
                    {
                        "scene_type": "실제 영상 얼굴 후보",
                        "start_time": format_time(timestamp_seconds),
                        "end_time": format_time(timestamp_seconds + sample_seconds),
                        "timestamp_seconds": timestamp_seconds,
                        "similarity": 0,
                        "confidence": "실제 검출",
                        "gradient": "linear-gradient(135deg, #0b8f68, #1d7cff)",
                        "bbox": bbox,
                        "det_score": float(face.det_score),
                        "crop_path": crop_path,
                    }
                )
            frame_index += sample_every_frames
    finally:
        cap.release()
        if remote_source:
            cleanup_temp_video(source_path)

    skipped_frames = max(0, min(total_frames, frame_index) - sampled_frames) if total_frames else 0

    if not embeddings:
        updated = update_video_status(
            video_id,
            "no_faces_found",
            frames=sampled_frames,
            skipped=skipped_frames,
            faces=0,
            embeddings=0,
            shots=sampled_frames,
            skip_rate=calc_skip_rate(skipped_frames, total_frames),
            faiss_ready=0,
        )
        return {
            **updated,
            "runtime": runtime,
            "real_mode": True,
            "message": "영상을 분석했지만 검출된 얼굴이 없습니다.",
        }

    matrix = np.vstack(embeddings).astype("float32")
    index = faiss.IndexFlatIP(matrix.shape[1])
    index.add(matrix)

    index_path = INDEX_DIR / f"video_{video_id}.faiss"
    meta_path = INDEX_DIR / f"video_{video_id}_meta.json"
    write_faiss_index(index, index_path)
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    updated = update_video_status(
        video_id,
        "analysis_ready",
        frames=sampled_frames,
        skipped=skipped_frames,
        faces=face_count,
        embeddings=len(embeddings),
        shots=sampled_frames,
        skip_rate=calc_skip_rate(skipped_frames, total_frames),
        faiss_ready=1,
    )
    return {
        **updated,
        "runtime": runtime,
        "real_mode": True,
        "message": "영상에서 얼굴 임베딩과 FAISS 인덱스를 생성했습니다.",
    }


def process_real_video(video_id: int, source_path: Path, runtime: dict, remote_source: bool = False):
    import cv2
    import faiss

    app = get_face_app()
    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        raise FaceInferenceError("video_open_failed")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    sample_every_frames = max(1, int(fps * 2))
    max_samples = 180

    embeddings = []
    metadata = []
    sampled_frames = 0
    skipped_frames = 0
    face_count = 0
    frame_index = 0

    while sampled_frames < max_samples:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % sample_every_frames != 0:
            frame_index += 1
            skipped_frames += 1
            continue

        timestamp_seconds = frame_index / fps
        sampled_frames += 1
        faces = app.get(frame)
        if not faces:
            frame_index += 1
            continue

        for face in faces:
            vector = np.asarray(face.embedding, dtype=np.float32)
            norm = np.linalg.norm(vector)
            if norm:
                vector = vector / norm
            embeddings.append(vector)
            face_count += 1
            metadata.append(
                {
                    "scene_type": "실제 영상 얼굴 후보",
                    "start_time": format_time(timestamp_seconds),
                    "end_time": format_time(timestamp_seconds + 2),
                    "timestamp_seconds": timestamp_seconds,
                    "similarity": 0,
                    "confidence": "실제 검색 전",
                    "gradient": "linear-gradient(135deg, #0b8f68, #1d7cff)",
                    "bbox": [float(value) for value in face.bbox.tolist()],
                    "det_score": float(face.det_score),
                }
            )
        frame_index += 1

    cap.release()

    if not embeddings:
        updated = update_video_status(
            video_id,
            "no_faces_found",
            frames=sampled_frames,
            skipped=skipped_frames,
            faces=0,
            embeddings=0,
            shots=sampled_frames,
            skip_rate=calc_skip_rate(skipped_frames, total_frames),
            faiss_ready=0,
        )
        return {
            **updated,
            "runtime": runtime,
            "real_mode": True,
            "message": "실제 영상은 열었지만 검출된 얼굴이 없습니다.",
        }

    matrix = np.vstack(embeddings).astype("float32")
    index = faiss.IndexFlatIP(matrix.shape[1])
    index.add(matrix)

    index_path = INDEX_DIR / f"video_{video_id}.faiss"
    meta_path = INDEX_DIR / f"video_{video_id}_meta.json"
    write_faiss_index(index, index_path)
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    updated = update_video_status(
        video_id,
        "analysis_ready",
        frames=sampled_frames,
        skipped=skipped_frames,
        faces=face_count,
        embeddings=len(embeddings),
        shots=sampled_frames,
        skip_rate=calc_skip_rate(skipped_frames, total_frames),
        faiss_ready=1,
    )
    return {
        **updated,
        "runtime": runtime,
        "real_mode": True,
        "message": "실제 영상에서 얼굴 임베딩과 FAISS 인덱스를 생성했습니다.",
    }


def process_real_image(video_id: int, source_path: Path, runtime: dict):
    import cv2
    import faiss

    app = get_face_app()
    image_bytes = np.fromfile(str(source_path), dtype=np.uint8)
    image = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)
    if image is None:
        raise FaceInferenceError("image_open_failed")

    faces = app.get(image)
    if not faces:
        updated = update_video_status(
            video_id,
            "no_faces_found",
            frames=1,
            skipped=0,
            faces=0,
            embeddings=0,
            shots=1,
            skip_rate=0,
            faiss_ready=0,
        )
        return {
            **updated,
            "runtime": runtime,
            "real_mode": True,
            "message": "실제 사진은 열었지만 검출된 얼굴이 없습니다.",
        }

    embeddings = []
    metadata = []
    for face in faces:
        vector = np.asarray(face.embedding, dtype=np.float32)
        norm = np.linalg.norm(vector)
        if norm:
            vector = vector / norm
        embeddings.append(vector)
        metadata.append(
            {
                "scene_type": "실제 사진 얼굴 후보",
                "start_time": "00:00:00",
                "end_time": "00:00:00",
                "timestamp_seconds": 0,
                "similarity": 0,
                "confidence": "실제 검색 전",
                "gradient": "linear-gradient(135deg, #0b8f68, #1d7cff)",
                "bbox": [float(value) for value in face.bbox.tolist()],
                "det_score": float(face.det_score),
            }
        )

    matrix = np.vstack(embeddings).astype("float32")
    index = faiss.IndexFlatIP(matrix.shape[1])
    index.add(matrix)

    index_path = INDEX_DIR / f"video_{video_id}.faiss"
    meta_path = INDEX_DIR / f"video_{video_id}_meta.json"
    write_faiss_index(index, index_path)
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    updated = update_video_status(
        video_id,
        "analysis_ready",
        frames=1,
        skipped=0,
        faces=len(faces),
        embeddings=len(embeddings),
        shots=1,
        skip_rate=0,
        faiss_ready=1,
    )
    return {
        **updated,
        "runtime": runtime,
        "real_mode": True,
        "message": "실제 사진에서 얼굴 임베딩과 FAISS 인덱스를 생성했습니다.",
    }


def update_video_status(video_id, status, frames, skipped, faces, embeddings, shots, skip_rate, faiss_ready):
    with connect() as conn:
        conn.execute(
            """
            UPDATE videos
            SET processing_status = ?, frames_extracted = ?, frames_skipped = ?,
                faces_detected = ?, embeddings_indexed = ?, shots_detected = ?,
                skip_rate = ?, faiss_ready = ?
            WHERE id = ?
            """,
            (status, frames, skipped, faces, embeddings, shots, skip_rate, faiss_ready, video_id),
        )
        return row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone())


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
        face_profile = row_to_dict(conn.execute("SELECT * FROM face_profiles WHERE id = ?", (face_profile_id,)).fetchone())
        if not video:
            raise ValueError("video_not_found")
        if not face_profile:
            raise ValueError("face_profile_not_found")

    index_path = INDEX_DIR / f"video_{video_id}.faiss"
    meta_path = INDEX_DIR / f"video_{video_id}_meta.json"
    user_embedding_path = EMBEDDING_DIR / f"{face_profile['embedding_ref']}.npy"

    if not video["faiss_ready"] or not index_path.exists() or not meta_path.exists():
        return create_empty_search(
            video_id,
            face_profile_id,
            mode,
            "no_real_index",
            "이 영상은 실제 파일 기반 얼굴 인덱스가 없어 임의 결과를 표시하지 않습니다.",
        )
    if not user_embedding_path.exists():
        return create_empty_search(
            video_id,
            face_profile_id,
            mode,
            "no_user_embedding",
            "사용자 얼굴 임베딩 파일을 찾지 못했습니다.",
        )

    index = read_faiss_index(index_path)
    user_embedding = np.load(user_embedding_path).astype("float32")
    if user_embedding.ndim == 1:
        user_embedding = user_embedding.reshape(1, -1)

    scores, ids = index.search(user_embedding, min(5, index.ntotal))
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    matches = []
    for score, match_id in zip(scores[0], ids[0]):
        if match_id < 0:
            continue
        item = metadata[int(match_id)].copy()
        similarity = int(max(0, min(100, float(score) * 100)))
        item["similarity"] = similarity
        item["confidence"] = "높음" if similarity >= 75 else "보통" if similarity >= 55 else "낮음"
        matches.append(item)

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
                search_id, scene_type, start_time, end_time, similarity, confidence, gradient,
                bbox_json, timestamp_seconds, det_score, crop_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    search_id,
                    match["scene_type"],
                    match["start_time"],
                    match["end_time"],
                    match["similarity"],
                    match["confidence"],
                    match["gradient"],
                    json.dumps(match.get("bbox"), ensure_ascii=False) if match.get("bbox") is not None else None,
                    match.get("timestamp_seconds"),
                    match.get("det_score"),
                    match.get("crop_path"),
                )
                for match in matches
            ],
        )
    result = get_search(search_id)
    result["real_search"] = True
    result["message"] = "실제 사용자 임베딩과 실제 영상 FAISS 인덱스를 검색했습니다."
    return result


def create_empty_search(video_id, face_profile_id, mode, status, message):
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO search_requests (video_id, face_profile_id, mode, status, is_paid, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (video_id, face_profile_id, mode, status, 1, datetime.utcnow().isoformat()),
        )
        search_id = cursor.lastrowid
    result = get_search(search_id)
    result["real_search"] = False
    result["message"] = message
    return result


def get_search(search_id: int):
    with connect() as conn:
        search = row_to_dict(conn.execute("SELECT * FROM search_requests WHERE id = ?", (search_id,)).fetchone())
        if not search:
            return None
        matches = rows_to_dicts(conn.execute("SELECT * FROM search_results WHERE search_id = ?", (search_id,)).fetchall())
    search["is_paid"] = bool(search["is_paid"])
    for match in matches:
        bbox_json = match.pop("bbox_json", None)
        match["bbox"] = json.loads(bbox_json) if bbox_json else None
        match["face_crop_url"] = f"/search-results/{match['id']}/crop" if match["bbox"] else None
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


def format_time(seconds: float) -> str:
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def calc_skip_rate(skipped, total):
    if not total:
        return 0
    return int(max(0, min(100, skipped / total * 100)))

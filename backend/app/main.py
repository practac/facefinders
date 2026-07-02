from datetime import date
from typing import Optional
import json
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from app.db import connect, init_db, row_to_dict, rows_to_dicts
from app.services.pipeline import create_search, get_search, mark_paid, process_video, save_face_upload, save_video_upload

app = FastAPI(title="Face Highpass MVP API", version="0.1.0")

ALLOWED_MEDIA_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".jpg", ".jpeg", ".png", ".webp", ".bmp"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "http://127.0.0.1:4174",
        "http://localhost:4174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VideoCreate(BaseModel):
    title: str
    source_url: Optional[str] = ""
    home_team: str = "LG"
    away_team: str = "KIA"
    stadium: str = "잠실야구장"
    broadcast: str = "KBO 중계"


class SearchCreate(BaseModel):
    video_id: int
    face_profile_id: int
    mode: str = "fast"


class PaymentCreate(BaseModel):
    search_id: int
    product_name: str = "고화질 결과 단건"
    amount: int = 3900


class AdCreate(BaseModel):
    title: str
    placement: str = "결과 미리보기"
    target_url: str = "https://example.com"
    cta: str = "자세히 보기"


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/videos")
def list_videos():
    with connect() as conn:
        return rows_to_dicts(conn.execute("SELECT * FROM videos ORDER BY id DESC").fetchall())


@app.get("/videos/{video_id}")
def get_video(video_id: int):
    with connect() as conn:
        video = row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone())
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@app.post("/admin/videos")
def create_video(payload: VideoCreate):
    gradients = [
        "linear-gradient(135deg, #0b8f68, #1d7cff)",
        "linear-gradient(135deg, #d8342a, #23315f)",
        "linear-gradient(135deg, #153f7d, #f6c84c)",
    ]
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO videos (
                title, source_url, home_team, away_team, stadium, broadcast, game_date,
                processing_status, frames_extracted, frames_skipped, faces_detected,
                embeddings_indexed, shots_detected, skip_rate, crowd_score, faiss_ready,
                hero_gradient
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.title,
                payload.source_url,
                payload.home_team,
                payload.away_team,
                payload.stadium,
                payload.broadcast,
                date.today().isoformat(),
                "uploaded",
                0,
                0,
                0,
                0,
                0,
                0,
                70,
                0,
                gradients[cursor_seed(payload.title) % len(gradients)],
            ),
        )
        video = row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return video


@app.post("/admin/videos/upload")
async def upload_video(
    file: UploadFile = File(...),
    title: str = Form(...),
    home_team: str = Form("LG"),
    away_team: str = Form("KIA"),
    stadium: str = Form("잠실야구장"),
    broadcast: str = Form("KBO 중계"),
):
    filename = file.filename or "video.mp4"
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = file.content_type or ""
    valid_media_type = (
        content_type.startswith("video/")
        or content_type.startswith("image/")
        or content_type == "application/octet-stream"
        or not content_type
    )
    if suffix not in ALLOWED_MEDIA_EXTENSIONS or not valid_media_type:
        raise HTTPException(
            status_code=400,
            detail=f"영상 또는 사진 파일만 업로드할 수 있습니다. 받은 파일: {filename} ({content_type or 'unknown'})",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty video file")
    stored_path = save_video_upload(content, filename)
    gradients = [
        "linear-gradient(135deg, #0b8f68, #1d7cff)",
        "linear-gradient(135deg, #d8342a, #23315f)",
        "linear-gradient(135deg, #153f7d, #f6c84c)",
    ]
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO videos (
                title, source_url, home_team, away_team, stadium, broadcast, game_date,
                processing_status, frames_extracted, frames_skipped, faces_detected,
                embeddings_indexed, shots_detected, skip_rate, crowd_score, faiss_ready,
                hero_gradient
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                stored_path,
                home_team,
                away_team,
                stadium,
                broadcast,
                date.today().isoformat(),
                "uploaded",
                0,
                0,
                0,
                0,
                0,
                0,
                70,
                0,
                gradients[cursor_seed(title) % len(gradients)],
            ),
        )
        video = row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return {**video, "uploaded_file": file.filename, "stored_path": stored_path}


@app.post("/admin/videos/{video_id}/process")
def run_video_process(video_id: int, background_tasks: BackgroundTasks):
    with connect() as conn:
        exists = conn.execute("SELECT 1 FROM videos WHERE id = ?", (video_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Video not found")
        conn.execute("UPDATE videos SET processing_status = ? WHERE id = ?", ("preprocessing", video_id))
    background_tasks.add_task(process_video, video_id)
    return process_video(video_id)


@app.delete("/admin/videos/{video_id}")
def delete_video(video_id: int):
    with connect() as conn:
        video = row_to_dict(conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone())
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")
        search_ids = [
            row["id"]
            for row in conn.execute("SELECT id FROM search_requests WHERE video_id = ?", (video_id,)).fetchall()
        ]
        for search_id in search_ids:
            conn.execute("DELETE FROM search_results WHERE search_id = ?", (search_id,))
            conn.execute("DELETE FROM payments WHERE search_id = ?", (search_id,))
        conn.execute("DELETE FROM search_requests WHERE video_id = ?", (video_id,))
        conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
    return {"deleted": True, "video": video, "removed_searches": len(search_ids)}


@app.post("/faces/upload")
async def upload_face(file: UploadFile = File(...), owner_name: str = Form("직관 관중")):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    return save_face_upload(content, file.filename or "face.jpg", owner_name)


@app.post("/search")
def search(payload: SearchCreate):
    try:
        return create_search(payload.video_id, payload.face_profile_id, payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/search/{search_id}")
def search_detail(search_id: int):
    search_result = get_search(search_id)
    if not search_result:
        raise HTTPException(status_code=404, detail="Search not found")
    return search_result


@app.get("/search-results/{result_id}/crop")
def search_result_crop(result_id: int):
    with connect() as conn:
        row = row_to_dict(
            conn.execute(
                """
                SELECT sr.bbox_json, sr.timestamp_seconds, v.source_url
                FROM search_results sr
                JOIN search_requests sq ON sq.id = sr.search_id
                JOIN videos v ON v.id = sq.video_id
                WHERE sr.id = ?
                """,
                (result_id,),
            ).fetchone()
        )
    if not row or not row.get("bbox_json"):
        raise HTTPException(status_code=404, detail="Face crop metadata not found")

    source_path = Path(row["source_url"] or "")
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Source media not found")

    try:
        import cv2
        import numpy as np

        suffix = source_path.suffix.lower()
        if suffix in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
            image_bytes = np.fromfile(str(source_path), dtype=np.uint8)
            frame = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)
        else:
            capture = cv2.VideoCapture(str(source_path))
            capture.set(cv2.CAP_PROP_POS_MSEC, float(row.get("timestamp_seconds") or 0) * 1000)
            ok, frame = capture.read()
            capture.release()
            if not ok:
                frame = None
        if frame is None:
            raise ValueError("frame_decode_failed")

        x1, y1, x2, y2 = [int(round(value)) for value in json.loads(row["bbox_json"])]
        height, width = frame.shape[:2]
        pad = max(12, int(max(x2 - x1, y2 - y1) * 0.25))
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(width, x2 + pad), min(height, y2 + pad)
        crop = frame[y1:y2, x1:x2]
        ok, encoded = cv2.imencode(".jpg", crop)
        if not ok:
            raise ValueError("crop_encode_failed")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Crop failed: {exc}") from exc

    return Response(content=encoded.tobytes(), media_type="image/jpeg")


@app.post("/payments/mock")
def mock_payment(payload: PaymentCreate):
    payment = mark_paid(payload.search_id, payload.product_name, payload.amount)
    return {"payment": payment, "search": get_search(payload.search_id)}


@app.get("/ads")
def list_ads():
    with connect() as conn:
        return rows_to_dicts(conn.execute("SELECT * FROM ads ORDER BY id DESC").fetchall())


@app.post("/ads")
def create_ad(payload: AdCreate):
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO ads (title, placement, target_url, cta, impressions, clicks, ctr, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (payload.title, payload.placement, payload.target_url, payload.cta, 0, 0, 0, "approved"),
        )
        ad = row_to_dict(conn.execute("SELECT * FROM ads WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return ad


def cursor_seed(value: str) -> int:
    return sum(ord(char) for char in value)

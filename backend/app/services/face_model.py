import hashlib
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.db import BASE_DIR

EMBEDDING_DIR = BASE_DIR / "embeddings"
MODEL_DIR = BASE_DIR / "models"


class FaceInferenceError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_face_app():
    try:
        from insightface.app import FaceAnalysis
    except Exception as exc:
        raise FaceInferenceError(f"insightface_import_failed: {exc}") from exc

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("INSIGHTFACE_HOME", str(MODEL_DIR))

    try:
        app = FaceAnalysis(name="buffalo_l", root=str(MODEL_DIR), providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=-1, det_size=(640, 640))
        return app
    except Exception as exc:
        raise FaceInferenceError(f"insightface_model_prepare_failed: {exc}") from exc


def deterministic_embedding(payload: bytes, dim: int = 512) -> np.ndarray:
    seed = hashlib.sha256(payload).digest()
    values = np.frombuffer((seed * ((dim * 4 // len(seed)) + 1))[: dim * 4], dtype=np.uint32)
    vector = (values.astype(np.float32) / np.iinfo(np.uint32).max) - 0.5
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def embed_face_image(file_bytes: bytes, source_name: str):
    import cv2

    EMBEDDING_DIR.mkdir(parents=True, exist_ok=True)
    image_array = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise FaceInferenceError("image_decode_failed")

    app = get_face_app()
    faces = app.get(image)
    if not faces:
        raise FaceInferenceError("face_not_detected")

    best_face = max(faces, key=lambda face: float(getattr(face, "det_score", 0.0)))
    embedding = np.asarray(best_face.embedding, dtype=np.float32)
    norm = np.linalg.norm(embedding)
    if norm:
        embedding = embedding / norm

    digest = hashlib.sha256(embedding.tobytes()).hexdigest()
    embedding_ref = f"arcface_{digest[:24]}"
    embedding_path = EMBEDDING_DIR / f"{embedding_ref}.npy"
    np.save(embedding_path, embedding)

    bbox = [float(value) for value in best_face.bbox.tolist()]
    quality_score = int(max(50, min(99, float(best_face.det_score) * 100)))
    return {
        "embedding_ref": embedding_ref,
        "embedding_path": str(embedding_path),
        "quality_score": quality_score,
        "face_count": len(faces),
        "bbox": bbox,
        "det_score": float(best_face.det_score),
        "model_status": "real_arcface",
        "source_name": source_name,
    }


def fallback_embedding(file_bytes: bytes, source_name: str, reason: str):
    EMBEDDING_DIR.mkdir(parents=True, exist_ok=True)
    embedding = deterministic_embedding(file_bytes or source_name.encode("utf-8"))
    digest = hashlib.sha256(embedding.tobytes()).hexdigest()
    embedding_ref = f"mock_{digest[:24]}"
    embedding_path = EMBEDDING_DIR / f"{embedding_ref}.npy"
    np.save(embedding_path, embedding)
    return {
        "embedding_ref": embedding_ref,
        "embedding_path": str(embedding_path),
        "quality_score": 72 + (file_bytes[0] % 24 if file_bytes else 12),
        "face_count": 0,
        "bbox": None,
        "det_score": None,
        "model_status": "mock_fallback",
        "fallback_reason": reason,
        "source_name": source_name,
    }


def infer_or_fallback(file_bytes: bytes, source_name: str):
    try:
        return embed_face_image(file_bytes, source_name)
    except Exception as exc:
        return fallback_embedding(file_bytes, source_name, str(exc))

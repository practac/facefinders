# FaceFinders SpotMe

야구 중계 영상에서 사용자의 얼굴 후보 장면을 찾는 MVP입니다.

## Stack

- Frontend: Vite React
- Backend: FastAPI
- DB: SQLite
- AI pipeline: yt-dlp, FFmpeg, OpenCV, InsightFace, FAISS

## Recommended Run

프론트엔드 빌드 파일을 FastAPI가 함께 서빙하므로 앱과 API를 모두 8000번 포트에서 확인할 수 있습니다.

```powershell
cmd /c npm install
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
cmd /c npm run serve
```

Open:

```text
http://127.0.0.1:8000/
```

## Development

개발 중에는 Vite 개발 서버를 사용할 수 있습니다. API 요청은 Vite proxy를 통해 `http://127.0.0.1:8000` 백엔드로 전달됩니다.

```powershell
.\.venv\Scripts\python -m uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port 8000
cmd /c npm run dev
```

## API

- `GET /videos`
- `GET /videos/{id}`
- `POST /admin/videos`
- `POST /admin/videos/{id}/process`
- `POST /faces/upload`
- `POST /search`
- `GET /search/{id}`
- `GET /search-results/{id}/crop`
- `POST /payments/mock`
- `GET /ads`
- `POST /ads`

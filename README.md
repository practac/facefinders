# Face Highpass MVP

AI 얼굴인식으로 야구 중계 영상 속 내 얼굴을 찾는 MVP 프로토타입입니다.

## 구성

- Frontend: Vite React
- Backend: FastAPI
- DB: SQLite
- AI pipeline: FFmpeg/OpenCV/FAISS 설치 시 실제 처리 경로를 사용할 수 있게 설계하고, 환경이 부족하면 mock fallback으로 데모 플로우를 유지합니다.

## 실행

### 1. 프론트엔드

```powershell
cmd /c npm install
cmd /c npm run dev
```

### 2. 백엔드

Python 3.11 venv를 권장합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port 8000
```

현재 PC에 Python 3.13만 있으면 일부 ML 패키지 설치가 실패할 수 있습니다. 그 경우 FastAPI 데모에 필요한 패키지만 설치하거나 Python 3.11을 설치하세요.

## 주요 플로우

1. 홈에서 경기 영상 선택
2. 얼굴 사진 업로드
3. 저장된 영상 FAISS 인덱스와 빠른 검색
4. 저화질 결과 미리보기
5. mock 결제로 고화질 결과 잠금 해제

## API

- `GET /videos`
- `GET /videos/{id}`
- `POST /admin/videos`
- `POST /admin/videos/{id}/process`
- `POST /faces/upload`
- `POST /search`
- `GET /search/{id}`
- `POST /payments/mock`
- `GET /ads`
- `POST /ads`

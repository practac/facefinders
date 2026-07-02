import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8001";

const api = {
  async get(path) {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async post(path, body, isForm = false) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: isForm ? undefined : { "Content-Type": "application/json" },
      body: isForm ? body : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async delete(path) {
    const response = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
};

const steps = ["영상 선택", "얼굴 업로드", "빠른 검색", "결과 확인"];

function App() {
  const [view, setView] = useState("fan");
  const [fanStep, setFanStep] = useState("home");
  const [videos, setVideos] = useState([]);
  const [ads, setAds] = useState([]);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [faceProfile, setFaceProfile] = useState(null);
  const [search, setSearch] = useState(null);
  const [paidResult, setPaidResult] = useState(false);
  const [lastCreatedVideo, setLastCreatedVideo] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingNotice, setLoadingNotice] = useState(null);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ team: "전체", status: "전체" });

  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? videos[0];

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const [videoData, adData] = await Promise.all([api.get("/videos"), api.get("/ads")]);
    setVideos(videoData);
    setAds(adData);
    if (!selectedVideoId && videoData[0]) setSelectedVideoId(videoData[0].id);
  }

  function logAction(title, detail, payload) {
    setActivityLog((items) => [
      {
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        title,
        detail,
        payload,
      },
      ...items,
    ].slice(0, 8));
  }

  function beginLoading(title, detail) {
    setLoading(true);
    setLoadingNotice({ title, detail });
    setMessage(detail);
  }

  function endLoading() {
    setLoading(false);
    setLoadingNotice(null);
  }

  const filteredVideos = useMemo(() => {
    return videos.filter((video) => {
      const teamMatch = filters.team === "전체" || video.home_team === filters.team || video.away_team === filters.team;
      const statusMatch = filters.status === "전체" || video.processing_status === filters.status;
      return teamMatch && statusMatch;
    });
  }, [videos, filters]);

  async function uploadFace(file) {
    if (!file || !selectedVideo) return;
    beginLoading("얼굴 사진 업로드 중", "업로드한 얼굴 사진을 서버에 저장하고 InsightFace/ArcFace 임베딩을 생성하고 있습니다.");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("owner_name", "직관 관중");
      const profile = await api.post("/faces/upload", formData, true);
      setFaceProfile(profile);
      setFanStep("search");
      setMessage("얼굴 사진 업로드가 완료되었습니다. 이제 선택한 미디어의 저장된 얼굴 인덱스와 비교할 수 있습니다.");
      logAction(
        "얼굴 사진 업로드 완료",
        `${profile.filename} · ${profile.model_status ?? "unknown"} · 품질 ${profile.quality_score}% · 임베딩 ${profile.embedding_ref}`,
        profile
      );
    } catch (error) {
      setMessage(`얼굴 사진 업로드 실패: ${error.message}`);
      logAction("얼굴 사진 업로드 실패", error.message, { error: String(error) });
    } finally {
      endLoading();
    }
  }

  async function startSearch() {
    if (!selectedVideo || !faceProfile) return;
    setPaidResult(false);
    beginLoading("얼굴 검색 중", "사용자 얼굴 임베딩과 선택 미디어의 FAISS 인덱스를 비교하고 있습니다.");
    try {
      const created = await api.post("/search", {
        video_id: selectedVideo.id,
        face_profile_id: faceProfile.id,
        mode: "fast",
      });
      setSearch(created);
      setPaidResult(true);
      setFanStep("result");
      if (created.matches?.length) {
        setMessage(`실제 얼굴 후보 ${created.matches.length}건을 찾았습니다.`);
        logAction("얼굴 검색 완료", `${created.matches.length}개 후보 장면 발견`, created);
      } else {
        setMessage(created.message || "실제 얼굴 후보를 찾지 못했습니다.");
        logAction("얼굴 검색 결과 없음", created.message || "실제 인덱스 또는 매칭 결과 없음", created);
      }
    } catch (error) {
      setMessage(`얼굴 검색 실패: ${error.message}`);
      logAction("얼굴 검색 실패", error.message, { error: String(error) });
    } finally {
      endLoading();
    }
  }

  async function processVideo(videoId) {
    beginLoading("미디어 전처리 중", "사진은 단일 프레임으로, 영상은 샘플 프레임 단위로 얼굴을 검출하고 FAISS 인덱스를 생성하고 있습니다.");
    try {
      const processed = await api.post(`/admin/videos/${videoId}/process`, {});
      await refresh();
      setMessage("미디어 전처리와 얼굴 인덱싱이 완료되었습니다.");
      logAction("영상 전처리 완료", `${processed.title} · ${processed.embeddings_indexed} embeddings · skip ${processed.skip_rate}%`, processed);
    } catch (error) {
      setMessage(`미디어 전처리 실패: ${error.message}`);
      logAction("영상 전처리 실패", error.message, { error: String(error) });
    } finally {
      endLoading();
    }
  }

  async function createVideo(event, selectedVideoFile) {
    event.preventDefault();
    beginLoading(
      selectedVideoFile ? "파일 업로드 중" : "영상 링크 등록 중",
      selectedVideoFile ? "선택한 사진/영상 파일을 서버에 저장하고 있습니다." : "입력한 영상 메타데이터와 링크를 저장하고 있습니다."
    );
    const form = new FormData(event.currentTarget);
    let created;
    try {
      if (selectedVideoFile) {
        form.append("file", selectedVideoFile);
        created = await api.post("/admin/videos/upload", form, true);
      } else {
        created = await api.post("/admin/videos", Object.fromEntries(form.entries()));
      }
      setLastCreatedVideo(created);
      setSelectedVideoId(created.id);
      event.currentTarget.reset();
      await refresh();
      setMessage(`미디어가 등록되었습니다: ${created.title}`);
      logAction(
        selectedVideoFile ? "파일 업로드 완료" : "영상 링크 등록 완료",
        `${created.title} · ${created.uploaded_file || created.source_url || "URL 없음"}`,
        created
      );
    } catch (error) {
      setMessage(`미디어 등록 실패: ${error.message}`);
      logAction("미디어 등록 실패", error.message, { error: String(error) });
    } finally {
      endLoading();
    }
  }

  async function deleteVideo(videoId) {
    beginLoading("미디어 삭제 중", "선택한 미디어와 연결된 검색 결과를 정리하고 있습니다.");
    try {
      const deleted = await api.delete(`/admin/videos/${videoId}`);
      if (selectedVideoId === videoId) setSelectedVideoId(null);
      if (lastCreatedVideo?.id === videoId) setLastCreatedVideo(null);
      await refresh();
      setMessage(`미디어가 삭제되었습니다: ${deleted.video.title}`);
      logAction("영상 삭제 완료", `${deleted.video.title} · 연결 검색 ${deleted.removed_searches}건 정리`, deleted);
    } catch (error) {
      setMessage(`미디어 삭제 실패: ${error.message}`);
      logAction("영상 삭제 실패", error.message, { error: String(error) });
    } finally {
      endLoading();
    }
  }

  async function createAd(event) {
    event.preventDefault();
    beginLoading("광고 캠페인 등록 중", "광고 캠페인 정보와 배너 위치를 저장하고 있습니다.");
    try {
      const form = new FormData(event.currentTarget);
      const created = await api.post("/ads", Object.fromEntries(form.entries()));
      event.currentTarget.reset();
      const adData = await api.get("/ads");
      setAds(adData);
      setMessage("광고 캠페인이 등록되었습니다.");
      logAction("광고 캠페인 등록 완료", `${created.title} · ${created.placement}`, created);
    } catch (error) {
      setMessage(`광고 캠페인 등록 실패: ${error.message}`);
      logAction("광고 캠페인 등록 실패", error.message, { error: String(error) });
    } finally {
      endLoading();
    }
  }

  async function pay() {
    if (!search) return;
    beginLoading("결제 처리 중", "Mock 결제를 처리하고 고화질 결과 잠금을 해제하고 있습니다.");
    try {
      await api.post("/payments/mock", { search_id: search.id, product_name: "고화질 결과 단건", amount: 3900 });
      const updated = await api.get(`/search/${search.id}`);
      setSearch(updated);
      setPaidResult(true);
      setMessage("결제가 완료되어 고화질 결과가 잠금 해제되었습니다.");
      logAction("Mock 결제 완료", `${updated.matches.length}개 고화질 결과 잠금 해제`, updated);
    } catch (error) {
      setMessage(`결제 처리 실패: ${error.message}`);
      logAction("Mock 결제 실패", error.message, { error: String(error) });
    } finally {
      endLoading();
    }
  }

  return (
    <main className="app">
      <Header view={view} setView={setView} setFanStep={setFanStep} />
      {message ? <div className="toast">{message}</div> : null}
      <LoadingOverlay notice={loadingNotice} />
      <ActivityPanel activityLog={activityLog} />
      {view === "fan" ? (
        <FanExperience
          ads={ads}
          fanStep={fanStep}
          setFanStep={setFanStep}
          videos={filteredVideos}
          allVideos={videos}
          selectedVideo={selectedVideo}
          selectedVideoId={selectedVideoId}
          setSelectedVideoId={setSelectedVideoId}
          filters={filters}
          setFilters={setFilters}
          faceProfile={faceProfile}
          uploadFace={uploadFace}
          startSearch={startSearch}
          search={search}
          paidResult={paidResult}
          pay={pay}
          loading={loading}
        />
      ) : null}
      {view === "admin" ? (
        <AdminConsole
          videos={videos}
          processVideo={processVideo}
          deleteVideo={deleteVideo}
          createVideo={createVideo}
          lastCreatedVideo={lastCreatedVideo}
        />
      ) : null}
      {view === "ads" ? <AdvertiserConsole ads={ads} createAd={createAd} /> : null}
    </main>
  );
}

function LoadingOverlay({ notice }) {
  if (!notice) return null;
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-spinner" aria-hidden="true" />
        <div>
          <strong>{notice.title}</strong>
          <span>{notice.detail}</span>
        </div>
      </div>
    </div>
  );
}

function Header({ view, setView, setFanStep }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => { setView("fan"); setFanStep("home"); }}>
        <span className="brand-mark">FH</span>
        <span>
          Face Highpass
          <small>야구 중계 속 내 얼굴 찾기</small>
        </span>
      </button>
      <nav>
        <button className={view === "fan" ? "active" : ""} onClick={() => { setView("fan"); setFanStep("home"); }}>팬 서비스</button>
        <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>운영자 콘솔</button>
        <button className={view === "ads" ? "active" : ""} onClick={() => setView("ads")}>광고주 콘솔</button>
      </nav>
    </header>
  );
}

function ActivityPanel({ activityLog }) {
  if (!activityLog.length) {
    return (
      <section className="activity-panel empty-activity">
        <strong>액션 응답 대기</strong>
        <span>클릭, 업로드, 등록, 삭제를 하면 이곳에 API 응답이 표시됩니다.</span>
      </section>
    );
  }

  return (
    <section className="activity-panel">
      <div className="activity-heading">
        <strong>최근 액션 응답</strong>
        <span>{activityLog.length}건</span>
      </div>
      <div className="activity-list">
        {activityLog.map((item) => (
          <details key={item.id}>
            <summary>
              <span>{item.time}</span>
              <strong>{item.title}</strong>
              <em>{item.detail}</em>
            </summary>
            <pre>{JSON.stringify(item.payload, null, 2)}</pre>
          </details>
        ))}
      </div>
    </section>
  );
}

function FanExperience(props) {
  const {
    ads,
    fanStep,
    setFanStep,
    videos,
    allVideos,
    selectedVideo,
    selectedVideoId,
    setSelectedVideoId,
    filters,
    setFilters,
    faceProfile,
    uploadFace,
    startSearch,
    search,
    paidResult,
    pay,
    loading,
  } = props;
  const teams = ["전체", ...new Set(allVideos.flatMap((video) => [video.home_team, video.away_team]))];
  const activeStep = fanStep === "result" ? 3 : fanStep === "search" ? 2 : fanStep === "upload" ? 1 : fanStep === "select" ? 0 : -1;

  if (fanStep === "home") {
    return (
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">KBO 방송 영상 얼굴 탐색 MVP</p>
          <h1>중계 화면에 잡힌 나를, 경기 하이라이트처럼 찾아보세요.</h1>
          <p>
            운영자가 미리 얼굴 임베딩과 FAISS 인덱스를 생성해두고, 사용자는 사진 한 장으로 빠르게 후보 장면을 확인합니다.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => setFanStep("select")}>얼굴 찾기 시작</button>
            <button className="secondary" onClick={() => setFanStep(search ? "result" : "select")}>최근 결과 보기</button>
          </div>
        </div>
        <div className="live-panel">
          <div className="live-header">
            <span>LIVE INDEX STATUS</span>
            <strong>{allVideos.filter((v) => v.processing_status === "analysis_ready").length}/{allVideos.length}</strong>
          </div>
          <div className="stadium-frame">
            <div className="score-strip">LG 7 : 5 KIA · 9회말 · 관중석 후보 우선 분석</div>
            <div className="crowd-grid">
              {Array.from({ length: 18 }).map((_, index) => <span key={index} />)}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="wizard-page">
      <StepRail active={activeStep} />
      {fanStep === "select" ? (
        <>
          <WizardHeader
            eyebrow="Step 1"
            title="분석할 경기 영상 선택"
            description="분석 가능 상태의 사진 또는 영상을 고르면 다음 단계에서 찾고 싶은 얼굴을 등록합니다."
          />
          <AdBanner ad={ads[0]} placement="영상 선택 화면 광고" />
          <section className="section-grid" id="videos">
            <div className="panel wide">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Video Library</p>
                  <h2>미디어 목록</h2>
                </div>
                <div className="filters">
                  <select value={filters.team} onChange={(event) => setFilters({ ...filters, team: event.target.value })}>
                    {teams.map((team) => <option key={team}>{team}</option>)}
                  </select>
                  <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                    <option>전체</option>
                    <option value="analysis_ready">분석 가능</option>
                    <option value="indexing">인덱싱 중</option>
                  </select>
                </div>
              </div>
              <div className="video-grid">
                {videos.map((video) => (
                  <button
                    key={video.id}
                    className={`video-card ${selectedVideoId === video.id ? "selected" : ""}`}
                    onClick={() => setSelectedVideoId(video.id)}
                  >
                    <div className="thumbnail" style={{ background: video.hero_gradient }}>
                      <span>{video.home_team} vs {video.away_team}</span>
                    </div>
                    <div className="video-meta">
                      <strong>{video.title}</strong>
                      <small>{video.game_date} · {video.stadium} · {video.broadcast}</small>
                      <div className="badges">
                        <span>{statusLabel(video.processing_status)}</span>
                        <span>관중 노출 {video.crowd_score}%</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <VideoDetail video={selectedVideo} />
          </section>
          <WizardActions
            backLabel="홈으로"
            onBack={() => setFanStep("home")}
            nextLabel="얼굴 사진 업로드"
            onNext={() => setFanStep("upload")}
            nextDisabled={!selectedVideo}
          />
        </>
      ) : null}

      {fanStep === "upload" ? (
        <>
          <WizardHeader
            eyebrow="Step 2"
            title="찾고 싶은 얼굴 등록"
            description="정면에 가깝고 흔들림이 적은 사진을 올리면 InsightFace/ArcFace 임베딩을 생성합니다."
          />
          <section className="section-grid single-focus">
            <FaceUpload faceProfile={faceProfile} uploadFace={uploadFace} startSearch={startSearch} disabled={!selectedVideo} loading={loading} showSearchButton={false} />
            <VideoDetail video={selectedVideo} />
          </section>
          <WizardActions
            backLabel="영상 다시 선택"
            onBack={() => setFanStep("select")}
            nextLabel="분석 단계로"
            onNext={() => setFanStep("search")}
            nextDisabled={!faceProfile}
          />
        </>
      ) : null}

      {fanStep === "search" ? (
        <>
          <WizardHeader
            eyebrow="Step 3"
            title="저장된 인덱스에서 얼굴 검색"
            description="선택한 미디어를 다시 분석하지 않고, 미리 만든 FAISS 인덱스와 업로드 얼굴 임베딩만 비교합니다."
          />
          <section className="section-grid single-focus">
            <AnalysisStatus video={selectedVideo} loading={loading} search={search} />
            <div className="panel compact">
              <p className="eyebrow">Ready</p>
              <h2>검색 준비 상태</h2>
              <div className="detail-list">
                <span>선택 미디어 <strong>{selectedVideo?.title ?? "없음"}</strong></span>
                <span>얼굴 임베딩 <strong>{faceProfile?.embedding_ref ?? "미등록"}</strong></span>
                <span>FAISS 인덱스 <strong>{selectedVideo?.faiss_ready ? "준비됨" : "대기"}</strong></span>
              </div>
              <button className="primary full" onClick={startSearch} disabled={!faceProfile || !selectedVideo || loading}>
                얼굴 검색 실행
              </button>
            </div>
          </section>
          <AdBanner ad={ads[1]} placement="분석 대기 화면 광고" />
          <WizardActions
            backLabel="얼굴 사진 다시 업로드"
            onBack={() => setFanStep("upload")}
            nextLabel="결과 보기"
            onNext={() => setFanStep("result")}
            nextDisabled={!search}
          />
        </>
      ) : null}

      {fanStep === "result" ? (
        <>
          <WizardHeader
            eyebrow="Step 4"
            title="얼굴 검색 결과 확인"
            description="결제 완료 상태로 처리되어 얼굴 crop, 시간대, 다운로드 리포트를 확인할 수 있습니다."
          />
          <ResultArea search={search} paidResult={paidResult} pay={pay} />
          <WizardActions
            backLabel="분석 단계로"
            onBack={() => setFanStep("search")}
            nextLabel="새 검색 시작"
            onNext={() => setFanStep("select")}
          />
        </>
      ) : null}
    </section>
  );
}

function WizardHeader({ eyebrow, title, description }) {
  return (
    <div className="wizard-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}

function WizardActions({ backLabel, onBack, nextLabel, onNext, nextDisabled = false }) {
  return (
    <div className="wizard-actions">
      <button className="secondary" onClick={onBack}>{backLabel}</button>
      <button className="primary" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>
    </div>
  );
}

function StepRail({ active }) {
  return (
    <div className="step-rail">
      {steps.map((step, index) => (
        <div key={step} className={index <= active ? "done" : ""}>
          <span>{index + 1}</span>
          {step}
        </div>
      ))}
    </div>
  );
}

function AdBanner({ ad, placement }) {
  return (
    <aside className="ad-banner">
      <div>
        <span>{placement}</span>
        <strong>{ad?.title ?? "스폰서 캠페인 대기 중"}</strong>
      </div>
      <a href={ad?.target_url ?? "#"}>{ad?.cta ?? "자세히 보기"}</a>
    </aside>
  );
}

function VideoDetail({ video }) {
  if (!video) return null;
  return (
    <aside className="panel compact">
      <p className="eyebrow">선택 영상</p>
      <h2>{video.title}</h2>
      <div className="detail-list">
        <span>경기일 <strong>{video.game_date}</strong></span>
        <span>구장 <strong>{video.stadium}</strong></span>
        <span>방송사 <strong>{video.broadcast}</strong></span>
        <span>처리상태 <strong>{statusLabel(video.processing_status)}</strong></span>
      </div>
      <div className="metric-row">
        <Metric label="추출 프레임" value={video.frames_extracted} />
        <Metric label="검출 얼굴" value={video.faces_detected} />
        <Metric label="대표 임베딩" value={video.embeddings_indexed} />
      </div>
      <p className="note">사용자 요청 시 영상 재분석 없이 저장된 인덱스만 검색합니다.</p>
    </aside>
  );
}

function FaceUpload({ faceProfile, uploadFace, startSearch, disabled, loading, showSearchButton = true }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Step 2</p>
          <h2>찾고 싶은 얼굴 등록</h2>
        </div>
        {faceProfile ? <span className="quality">품질 {faceProfile.quality_score}%</span> : null}
      </div>
      <label className="dropzone">
        <input type="file" accept="image/*" onChange={(event) => uploadFace(event.target.files?.[0])} />
        <strong>정면 얼굴 사진 업로드</strong>
        <span>밝고 흔들림 없는 사진일수록 유사도 검색이 안정적입니다.</span>
      </label>
      <div className="consent">
        <input type="checkbox" checked readOnly />
        <span>얼굴정보 분석 및 MVP 저장 정책에 동의함</span>
      </div>
      {faceProfile ? (
        <div className="upload-response">
          <strong>업로드 완료</strong>
          <span>파일: {faceProfile.filename}</span>
          <span>모델 상태: {faceProfile.model_status === "real_arcface" ? "실제 ArcFace 임베딩 생성" : "Mock fallback 임베딩"}</span>
          <span>검출 얼굴 수: {faceProfile.face_count ?? 0}</span>
          <span>품질 점수: {faceProfile.quality_score}%</span>
          <span>임베딩 ID: {faceProfile.embedding_ref}</span>
          {faceProfile.fallback_reason ? <span>Fallback 이유: {faceProfile.fallback_reason}</span> : null}
        </div>
      ) : null}
      {showSearchButton ? (
        <button className="primary full" onClick={startSearch} disabled={!faceProfile || disabled || loading}>
          미리 생성된 인덱스에서 검색
        </button>
      ) : null}
    </section>
  );
}

function AnalysisStatus({ video, loading, search }) {
  const pipeline = [
    ["Shot 분할", video?.shots_detected ?? 0],
    ["스킵 룰 적용", `${video?.skip_rate ?? 0}% 절감`],
    ["ArcFace 임베딩", video?.embeddings_indexed ?? 0],
    ["FAISS 인덱스", video?.faiss_ready ? "완료" : "대기"],
  ];
  return (
    <section className="panel">
      <p className="eyebrow">Step 3</p>
      <h2>분석 파이프라인</h2>
      <div className="pipeline">
        {pipeline.map(([label, value], index) => (
          <div key={label} className={index < 4 ? "ready" : ""}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className={`search-state ${loading ? "pulse" : ""}`}>
        <strong>{loading ? "검색 중" : search ? "후보 발견" : "검색 대기"}</strong>
        <span>{search ? `${search.matches.length}개 후보 장면` : "사진을 업로드하면 기존 인덱스와 비교합니다."}</span>
      </div>
    </section>
  );
}

function ResultArea({ search, paidResult, pay }) {
  const showFullResult = Boolean(search);
  const hasMatches = Boolean(search?.matches?.length);
  const bestMatch = hasMatches ? Math.max(...search.matches.map((item) => item.similarity)) : 0;

  function downloadResultReport() {
    if (!search) return;
    const report = {
      search_id: search.id,
      video_id: search.video_id,
      face_profile_id: search.face_profile_id,
      status: search.status,
      real_search: Boolean(search.real_search),
      generated_at: new Date().toISOString(),
      summary: {
        match_count: search.matches?.length ?? 0,
        best_similarity: bestMatch,
      },
      matches: (search.matches ?? []).map((match, index) => ({
        rank: index + 1,
        scene_type: match.scene_type,
        start_time: match.start_time,
        end_time: match.end_time,
        timestamp_seconds: match.timestamp_seconds,
        similarity: match.similarity,
        confidence: match.confidence,
        bbox: match.bbox,
        det_score: match.det_score,
        face_crop_url: match.face_crop_url ? `${API_BASE}${match.face_crop_url}` : null,
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `face-highpass-result-${search.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel result-panel" id="result">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Step 4</p>
          <h2>{hasMatches ? "얼굴 후보를 찾았습니다" : search ? "실제 분석 결과 없음" : "결과 미리보기"}</h2>
        </div>
        {hasMatches ? <span className="quality found">발견됨 · 최고 유사도 {bestMatch}%</span> : null}
      </div>
      {!search ? (
        <div className="empty-result">검색을 시작하면 저화질 후보 장면과 결제 잠금 영역이 표시됩니다.</div>
      ) : !hasMatches ? (
        <div className="empty-result honest-result">
          <strong>임의 결과를 표시하지 않았습니다.</strong>
          <span>{search.message || "이 영상에는 실제 얼굴 FAISS 인덱스가 없거나 매칭된 얼굴 후보가 없습니다."}</span>
          <span>운영자 콘솔에서 실제 영상 파일을 업로드한 뒤 전처리 실행을 완료해야 실제 검색 결과가 생성됩니다.</span>
          <small>검색 상태: {search.status}</small>
        </div>
      ) : (
        <>
          <div className="result-summary">
            <div>
              <strong>{search.matches.length}개의 얼굴 후보 장면 발견</strong>
              <span>{search.real_search ? "실제 사용자 임베딩과 실제 영상 FAISS 인덱스를 비교했습니다." : "실제 검색 상태를 확인할 수 없습니다."}</span>
            </div>
            <div className="summary-metrics">
              <Metric label="최고 유사도" value={`${bestMatch}%`} />
              <Metric label="결과 상태" value="발견" />
              <Metric label="결제 상태" value="완료" />
            </div>
          </div>
          <div className="result-grid">
            {search.matches.map((match, index) => (
              <article className={`result-card ${index === 0 ? "best-match" : ""}`} key={match.id}>
                <ResultCapture match={match} index={index} showFullResult={showFullResult} />
                <div className="result-info">
                  <div className="result-title-row">
                    <strong>{match.scene_type}</strong>
                    {index === 0 ? <span>BEST</span> : null}
                  </div>
                  <p>{showFullResult ? `${match.start_time} - ${match.end_time}` : "정확한 시간대는 결제 후 공개"}</p>
                  <small>
                    유사도 {match.similarity}% · 신뢰도 {match.confidence}
                    {match.bbox ? ` · 얼굴 위치 [${match.bbox.map((value) => Math.round(value)).join(", ")}]` : " · 얼굴 위치 정보 없음"}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {false && search && !paidResult && !search.is_paid ? (
        <button className="primary full" onClick={pay}>3,900원으로 고화질 결과 잠금 해제</button>
      ) : null}
      {search ? (
        <div className="download-strip">
          <strong>현재 MVP에서는 결제 완료 상태로 고화질 캡쳐, 정확한 시간대, SNS 공유용 클립 정보를 모두 표시합니다.</strong>
          <button className="secondary" onClick={downloadResultReport}>결과 다운로드</button>
        </div>
      ) : null}
    </section>
  );
}

function ResultCapture({ match, index, showFullResult }) {
  const cropUrl = match.face_crop_url ? `${API_BASE}${match.face_crop_url}` : null;
  return (
    <div className={`capture-frame capture-${index + 1} ${showFullResult ? "unlocked" : "locked"}`}>
      <div className="broadcast-bar">
        <span>KBO LIVE</span>
        <strong>{match.start_time}</strong>
      </div>
      {cropUrl ? (
        <img className="real-face-crop" src={cropUrl} alt={`얼굴 후보 ${index + 1}`} />
      ) : (
        <>
          <div className="crowd-sim">
            {Array.from({ length: 24 }).map((_, seatIndex) => (
              <span key={seatIndex} className={seatIndex === 8 + index * 3 ? "target-seat" : ""} />
            ))}
          </div>
          <div className={`face-box face-box-${index + 1}`}>
            <span>얼굴 후보</span>
          </div>
        </>
      )}
      <div className="face-crop">
        <div className="face-avatar">
          <span />
        </div>
        <strong>{match.similarity}% match</strong>
      </div>
      <em>{showFullResult ? "HD 후보 프레임" : "LOW PREVIEW"}</em>
    </div>
  );
}

function AdminConsole({ videos, processVideo, deleteVideo, createVideo, lastCreatedVideo }) {
  const [selectedVideoFile, setSelectedVideoFile] = useState(null);
  const [fileError, setFileError] = useState("");

  async function handleCreateVideo(event) {
    event.preventDefault();
    if (!selectedVideoFile) {
      setFileError("실제 분석을 하려면 mp4/mov 같은 영상 파일 또는 jpg/png 같은 사진 파일을 선택하세요.");
      return;
    }
    await createVideo(event, selectedVideoFile);
    setSelectedVideoFile(null);
    setFileError("");
  }

  function handleVideoFileChange(event) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedVideoFile(null);
      setFileError("");
      return;
    }
    const allowedByType = file.type.startsWith("video/") || file.type.startsWith("image/");
    const allowedByName = /\.(mp4|mov|mkv|avi|webm|m4v|jpe?g|png|webp|bmp)$/i.test(file.name);
    if (!allowedByType && !allowedByName) {
      setSelectedVideoFile(null);
      setFileError(`지원하지 않는 파일 형식입니다: ${file.name}`);
      event.target.value = "";
      return;
    }
    setSelectedVideoFile(file);
    setFileError("");
  }

  return (
    <section className="console">
      <div className="console-header">
        <div>
          <p className="eyebrow">Admin Console</p>
          <h1>영상 등록과 얼굴 인덱싱 관리</h1>
        </div>
        <div className="metric-row">
          <Metric label="분석 완료" value={videos.filter((v) => v.faiss_ready).length} />
          <Metric label="총 영상" value={videos.length} />
          <Metric label="평균 스킵률" value={`${Math.round(avg(videos.map((v) => v.skip_rate)))}%`} />
        </div>
      </div>
      {lastCreatedVideo ? (
        <div className="panel created-video">
          <div>
            <p className="eyebrow">방금 등록됨</p>
            <h2>{lastCreatedVideo.title}</h2>
            <p>{lastCreatedVideo.source_url || "링크 없이 수동 등록된 영상입니다."}</p>
          </div>
          <button className="primary" onClick={() => processVideo(lastCreatedVideo.id)}>바로 전처리 실행</button>
        </div>
      ) : null}
      <div className="section-grid">
        <form className="panel form" onSubmit={handleCreateVideo}>
          <h2>영상 업로드/링크 등록</h2>
          <p className="form-help">모델 테스트용 사진 또는 실제 영상 파일을 업로드한 뒤 전처리 실행을 누르면 실제 얼굴 임베딩/FAISS 인덱싱을 시도합니다.</p>
          <input name="title" placeholder="경기 제목" required />
          <input name="source_url" type="hidden" value={selectedVideoFile?.name ?? ""} readOnly />
          <div className="file-picker">
            <input
              id="video-source-file"
              className="file-picker-input"
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm,image/jpeg,image/png,image/webp,image/bmp,.mp4,.mov,.mkv,.avi,.webm,.m4v,.jpg,.jpeg,.png,.webp,.bmp"
              onChange={handleVideoFileChange}
            />
            <label className="secondary" htmlFor="video-source-file">파일 찾기</label>
            <span>{selectedVideoFile?.name ?? "선택된 파일 없음"}</span>
          </div>
          {fileError ? <div className="field-error">{fileError}</div> : null}
          <input name="home_team" placeholder="홈팀" defaultValue="LG" />
          <input name="away_team" placeholder="원정팀" defaultValue="KIA" />
          <input name="stadium" placeholder="구장" defaultValue="잠실야구장" />
          <input name="broadcast" placeholder="방송사" defaultValue="KBO 중계" />
          <button className="primary full">등록</button>
        </form>
        <div className="panel">
          <h2>분석 작업 큐</h2>
          <div className="admin-list">
            {videos.map((video) => (
              <article key={video.id} className={lastCreatedVideo?.id === video.id ? "new-item" : ""}>
                <div>
                  <strong>{video.title}</strong>
                  <span>
                    {statusLabel(video.processing_status)} · {video.embeddings_indexed} embeddings · skip {video.skip_rate}%
                    {video.source_url ? ` · ${video.source_url}` : ""}
                  </span>
                </div>
                <div className="row-actions">
                  <button className="secondary" onClick={() => processVideo(video.id)}>전처리 실행</button>
                  <button className="danger" onClick={() => deleteVideo(video.id)}>삭제</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AdvertiserConsole({ ads, createAd }) {
  return (
    <section className="console">
      <div className="console-header">
        <div>
          <p className="eyebrow">Advertiser Console</p>
          <h1>야구 팬 집중 구간 광고 캠페인</h1>
        </div>
        <div className="metric-row">
          <Metric label="노출" value={ads.reduce((sum, ad) => sum + ad.impressions, 0)} />
          <Metric label="클릭" value={ads.reduce((sum, ad) => sum + ad.clicks, 0)} />
          <Metric label="CTR" value={`${Math.round(avg(ads.map((ad) => ad.ctr)))}%`} />
        </div>
      </div>
      <div className="section-grid">
        <form className="panel form" onSubmit={createAd}>
          <h2>캠페인 등록</h2>
          <input name="title" placeholder="캠페인명" required />
          <input name="placement" placeholder="노출 위치" defaultValue="결과 미리보기" />
          <input name="target_url" placeholder="클릭 URL" defaultValue="https://example.com" />
          <input name="cta" placeholder="CTA" defaultValue="혜택 보기" />
          <button className="primary full">광고 등록</button>
        </form>
        <div className="panel">
          <h2>캠페인 성과</h2>
          <div className="admin-list">
            {ads.map((ad) => (
              <article key={ad.id}>
                <div>
                  <strong>{ad.title}</strong>
                  <span>{ad.placement} · {ad.impressions} impressions · CTR {ad.ctr}%</span>
                </div>
                <button className="secondary">리포트</button>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function statusLabel(status) {
  return {
    analysis_ready: "분석 가능",
    uploaded: "업로드 완료",
    preprocessing: "전처리 중",
    indexing: "인덱싱 중",
    needs_video_file: "실제 파일 필요",
    no_faces_found: "얼굴 미검출",
    model_unavailable: "모델 처리 실패",
    invalid_video_file: "영상 파일 아님",
  }[status] ?? status;
}

function avg(values) {
  const valid = values.filter((value) => Number.isFinite(Number(value)));
  return valid.length ? valid.reduce((sum, value) => sum + Number(value), 0) / valid.length : 0;
}

createRoot(document.getElementById("root")).render(<App />);

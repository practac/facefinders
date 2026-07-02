import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScanFace } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

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
  const [devTab, setDevTab] = useState("admin");
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
    const formElement = event.currentTarget;
    beginLoading(
      selectedVideoFile ? "파일 업로드 중" : "영상 링크 등록 중",
      selectedVideoFile ? "선택한 사진/영상 파일을 서버에 저장하고 있습니다." : "입력한 영상 메타데이터와 링크를 저장하고 있습니다."
    );
    const form = new FormData(formElement);
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
      formElement.reset();
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
      {view === "dev" ? (
        <DeveloperConsole
          devTab={devTab}
          setDevTab={setDevTab}
          videos={videos}
          ads={ads}
          activityLog={activityLog}
          processVideo={processVideo}
          deleteVideo={deleteVideo}
          createVideo={createVideo}
          createAd={createAd}
          lastCreatedVideo={lastCreatedVideo}
        />
      ) : null}
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
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const updateHeaderState = () => setIsScrolled(window.scrollY > 8);

    updateHeaderState();
    window.addEventListener("scroll", updateHeaderState, { passive: true });
    return () => window.removeEventListener("scroll", updateHeaderState);
  }, []);

  return (
    <header className={`topbar ${isScrolled ? "scrolled" : ""}`}>
      <Button variant="ghost" className="brand" onClick={() => { setView("fan"); setFanStep("home"); }}>
        <span className="brand-mark" aria-hidden="true">
          <ScanFace className="brand-mark-icon" strokeWidth={2.4} />
        </span>
        <span>
          SpotMe
          <small>야구 중계 속 내 얼굴 찾기</small>
        </span>
      </Button>
      <nav>
        <Button variant="ghost" className={view === "fan" ? "active" : ""} onClick={() => { setView("fan"); setFanStep("home"); }}>내 얼굴 찾기</Button>
        <Button variant="ghost" className={`dev-nav ${view === "dev" ? "active" : ""}`} onClick={() => setView("dev")}>개발자 테스트</Button>
      </nav>
    </header>
  );
}

function ActivityPanel({ activityLog }) {
  if (!activityLog.length) {
    return (
      <Card className="activity-panel empty-activity">
        <strong>액션 응답 대기</strong>
        <span>클릭, 업로드, 등록, 삭제를 하면 이곳에 API 응답이 표시됩니다.</span>
      </Card>
    );
  }

  return (
    <Card className="activity-panel">
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
    </Card>
  );
}

function DeveloperConsole({
  devTab,
  setDevTab,
  videos,
  ads,
  activityLog,
  processVideo,
  deleteVideo,
  createVideo,
  createAd,
  lastCreatedVideo,
}) {
  return (
    <section className="developer-page">
      <div className="developer-header">
        <div>
          <p className="eyebrow">Developer Test</p>
          <h1>운영/광고/백데이터 테스트</h1>
          <p>일반 사용자에게 노출하지 않는 API 응답, 운영자 기능, 광고주 기능을 이곳에서 확인합니다.</p>
        </div>
        <div className="api-pill">
          <span>API</span>
          <strong>{API_BASE}</strong>
        </div>
      </div>
      <Tabs className="dev-tabs">
        <TabsList>
          <TabsTrigger active={devTab === "admin"} onClick={() => setDevTab("admin")}>운영자</TabsTrigger>
          <TabsTrigger active={devTab === "ads"} onClick={() => setDevTab("ads")}>광고주</TabsTrigger>
          <TabsTrigger active={devTab === "logs"} onClick={() => setDevTab("logs")}>백데이터</TabsTrigger>
        </TabsList>
      </Tabs>
      {devTab === "admin" ? (
        <AdminConsole
          videos={videos}
          processVideo={processVideo}
          deleteVideo={deleteVideo}
          createVideo={createVideo}
          lastCreatedVideo={lastCreatedVideo}
        />
      ) : null}
      {devTab === "ads" ? <AdvertiserConsole ads={ads} createAd={createAd} /> : null}
      {devTab === "logs" ? (
        <div className="section-grid">
          <ActivityPanel activityLog={activityLog} />
          <Card className="panel compact">
            <p className="eyebrow">Runtime</p>
            <h2>테스트 상태</h2>
            <div className="detail-list">
              <span>API Base <strong>{API_BASE}</strong></span>
              <span>등록 미디어 <strong>{videos.length}</strong></span>
              <span>검색 가능 미디어 <strong>{videos.filter((video) => video.faiss_ready).length}</strong></span>
              <span>광고 캠페인 <strong>{ads.length}</strong></span>
            </div>
          </Card>
        </div>
      ) : null}
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
          <p className="eyebrow">TV 방송 속 내 얼굴 탐색</p>
          <h1 className="hero-title">
            <span>중계 화면에 잡힌 내 얼굴을</span>
            <span>찾아보세요.</span>
          </h1>
          <p>
            SpotMe는 방송 화면에 잡힌 당신을 찾아주는 서비스입니다. 
          </p>
          <div className="hero-actions">
            <Button onClick={() => setFanStep("select")}>얼굴 찾기 시작</Button>
            <Button variant="secondary" onClick={() => setFanStep(search ? "result" : "select")}>최근 결과 보기</Button>
          </div>
        </div>
        <div className="live-panel">
          <div className="live-header">
            <span>얼굴 검색 준비 완료</span>
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
            <Card className="panel wide">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Video Library</p>
                  <h2>미디어 목록</h2>
                </div>
                <div className="filters">
                  <Select value={filters.team} onChange={(event) => setFilters({ ...filters, team: event.target.value })}>
                    {teams.map((team) => <option key={team}>{team}</option>)}
                  </Select>
                  <Select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                    <option>전체</option>
                    <option value="analysis_ready">분석 가능</option>
                    <option value="indexing">인덱싱 중</option>
                  </Select>
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
                        <Badge variant={video.faiss_ready ? "success" : "secondary"}>{statusLabel(video.processing_status)}</Badge>
                        <Badge variant="outline">관중 노출 {video.crowd_score}%</Badge>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
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
            <Card className="panel compact">
              <p className="eyebrow">Ready</p>
              <h2>검색 준비 상태</h2>
              <div className="detail-list">
                <span>선택 미디어 <strong>{selectedVideo?.title ?? "없음"}</strong></span>
                <span>얼굴 임베딩 <strong>{faceProfile?.embedding_ref ?? "미등록"}</strong></span>
                <span>FAISS 인덱스 <strong>{selectedVideo?.faiss_ready ? "준비됨" : "대기"}</strong></span>
              </div>
              <Button className="full" onClick={startSearch} disabled={!faceProfile || !selectedVideo || loading}>
                얼굴 검색 실행
              </Button>
            </Card>
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
      <Button variant="secondary" onClick={onBack}>{backLabel}</Button>
      <Button onClick={onNext} disabled={nextDisabled}>{nextLabel}</Button>
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
    <Card className="panel compact">
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
    </Card>
  );
}

function FaceUpload({ faceProfile, uploadFace, startSearch, disabled, loading, showSearchButton = true }) {
  return (
    <Card className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Step 2</p>
          <h2>찾고 싶은 얼굴 등록</h2>
        </div>
        {faceProfile ? <Badge variant="success">품질 {faceProfile.quality_score}%</Badge> : null}
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
        <Button className="full" onClick={startSearch} disabled={!faceProfile || disabled || loading}>
          미리 생성된 인덱스에서 검색
        </Button>
      ) : null}
    </Card>
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
    <Card className="panel">
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
    </Card>
  );
}

function ResultArea({ search, paidResult, pay }) {
  const showFullResult = Boolean(search);
  const hasMatches = Boolean(search?.matches?.length);
  const bestMatch = hasMatches ? Math.max(...search.matches.map((item) => item.similarity)) : 0;
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const selectedMatch = hasMatches
    ? search.matches.find((match) => match.id === selectedMatchId) ?? search.matches[0]
    : null;
  const selectedMatchIndex = selectedMatch ? search.matches.findIndex((match) => match.id === selectedMatch.id) : -1;

  useEffect(() => {
    if (!search?.matches?.length) {
      setSelectedMatchId(null);
      return;
    }

    setSelectedMatchId((currentId) => {
      return search.matches.some((match) => match.id === currentId) ? currentId : search.matches[0].id;
    });
  }, [search]);

  async function downloadSelectedImage() {
    if (!search || !selectedMatch) return;

    const cropUrl = selectedMatch.face_crop_url ? `${API_BASE}${selectedMatch.face_crop_url}` : null;
    const rank = Math.max(selectedMatchIndex + 1, 1);
    const baseName = `spotme-result-${search.id}-rank-${rank}`;
    let blob;
    let filename = `${baseName}.png`;

    if (cropUrl) {
      try {
        const response = await fetch(cropUrl);
        if (!response.ok) throw new Error("image request failed");
        blob = await response.blob();
        filename = `${baseName}.${imageExtension(blob.type, cropUrl)}`;
      } catch (error) {
        blob = await createResultPreviewImage(selectedMatch, rank);
      }
    } else {
      blob = await createResultPreviewImage(selectedMatch, rank);
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="panel result-panel" id="result">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Step 4</p>
          <h2>{hasMatches ? "얼굴 후보를 찾았습니다" : search ? "실제 분석 결과 없음" : "결과 미리보기"}</h2>
        </div>
        {hasMatches ? <Badge variant="warning">발견됨 · 최고 유사도 {bestMatch}%</Badge> : null}
      </div>
      {!search ? (
        <div className="empty-result">검색을 시작하면 저화질 후보 장면과 결제 잠금 영역이 표시됩니다.</div>
      ) : !hasMatches ? (
        <div className="empty-result honest-result">
          <strong>임의 결과를 표시하지 않았습니다.</strong>
          <span>{search.message || "이 영상에는 실제 얼굴 FAISS 인덱스가 없거나 매칭된 얼굴 후보가 없습니다."}</span>
          <span>다른 경기나 더 선명한 얼굴 사진으로 다시 검색해보세요.</span>
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
              <article
                className={`result-card ${index === 0 ? "best-match" : ""} ${selectedMatch?.id === match.id ? "selected-result" : ""}`}
                key={match.id}
                role="radio"
                aria-checked={selectedMatch?.id === match.id}
                tabIndex={0}
                onClick={() => setSelectedMatchId(match.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedMatchId(match.id);
                  }
                }}
              >
                <ResultCapture match={match} index={index} showFullResult={showFullResult} />
                <div className="result-info">
                  <div className="result-title-row">
                    <strong>{match.scene_type}</strong>
                    <div className="result-title-badges">
                      {selectedMatch?.id === match.id ? <span>선택됨</span> : null}
                      {index === 0 ? <span>BEST</span> : null}
                    </div>
                  </div>
                  <p>{showFullResult ? `${match.start_time} - ${match.end_time}` : "정확한 시간대는 결제 후 공개"}</p>
                  <small>
                    유사도 {match.similarity}% · 신뢰도 {match.confidence}
                    {match.bbox ? ` · 얼굴 위치 [${match.bbox.map((value) => Math.round(value)).join(", ")}]` : " · 얼굴 위치 정보 없음"}
                  </small>
                  <span className="result-select-hint">{selectedMatch?.id === match.id ? "이 사진이 다운로드됩니다" : "클릭해서 사진 선택"}</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {false && search && !paidResult && !search.is_paid ? (
        <Button className="full" onClick={pay}>3,900원으로 고화질 결과 잠금 해제</Button>
      ) : null}
      {search ? (
        <div className="download-strip">
          <strong>
            {selectedMatch
              ? `선택한 후보 ${Math.max(selectedMatchIndex + 1, 1)}번 사진을 이미지 파일로 다운로드합니다.`
              : "다운로드할 사진을 선택하세요."}
          </strong>
          <Button variant="secondary" onClick={downloadSelectedImage} disabled={!selectedMatch}>선택한 사진 다운로드</Button>
        </div>
      ) : null}
    </Card>
  );
}

function imageExtension(contentType, url) {
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  const extension = url.split("?")[0].match(/\.(jpe?g|png|webp|bmp)$/i)?.[1];
  return extension?.replace("jpeg", "jpg").toLowerCase() ?? "png";
}

function createResultPreviewImage(match, rank) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");

    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#14532d");
    gradient.addColorStop(0.55, "#047857");
    gradient.addColorStop(1, "#0f172a");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "#f5c451";
    context.fillRect(0, 0, canvas.width, 108);
    context.fillStyle = "#071018";
    context.font = "700 42px Arial, sans-serif";
    context.fillText(`SpotMe 후보 ${rank} · ${match.start_time ?? "시간 정보 없음"}`, 44, 68);

    context.fillStyle = "rgba(240, 253, 250, 0.78)";
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const x = 154 + col * 128;
        const y = 190 + row * 100;
        context.beginPath();
        context.arc(x, y, 36, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.strokeStyle = "#f5c451";
    context.lineWidth = 8;
    context.strokeRect(488, 270, 150, 150);
    context.fillStyle = "#f5c451";
    context.fillRect(488, 228, 230, 42);
    context.fillStyle = "#071018";
    context.font = "700 24px Arial, sans-serif";
    context.fillText(`${match.similarity ?? "-"}% match`, 510, 257);

    context.fillStyle = "rgba(7, 16, 24, 0.72)";
    context.fillRect(44, 610, 650, 62);
    context.fillStyle = "#f8fafc";
    context.font = "700 26px Arial, sans-serif";
    context.fillText(match.scene_type ?? "얼굴 후보 장면", 70, 648);

    canvas.toBlob((blob) => resolve(blob ?? new Blob([], { type: "image/png" })), "image/png", 0.92);
  });
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
    const form = new FormData(event.currentTarget);
    const sourceUrl = String(form.get("source_url") ?? "").trim();
    if (!selectedVideoFile) {
      if (!sourceUrl) {
        setFileError("분석할 영상 파일을 선택하거나 유튜브 링크를 입력하세요.");
        return;
      }
      if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(sourceUrl)) {
        setFileError("현재 링크 등록은 youtube.com 또는 youtu.be 링크만 지원합니다.");
        return;
      }
    }
    if (selectedVideoFile && sourceUrl) {
      setFileError("파일 업로드와 유튜브 링크 중 하나만 선택하세요.");
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
        <Card className="panel created-video">
          <div>
            <p className="eyebrow">방금 등록됨</p>
            <h2>{lastCreatedVideo.title}</h2>
            <p>{lastCreatedVideo.source_url || "링크 없이 수동 등록된 영상입니다."}</p>
          </div>
          <Button onClick={() => processVideo(lastCreatedVideo.id)}>바로 전처리 실행</Button>
        </Card>
      ) : null}
      <div className="section-grid">
        <form className="panel form" onSubmit={handleCreateVideo}>
          <h2>영상 업로드/링크 등록</h2>
          <p className="form-help">영상 파일을 업로드하거나 유튜브 링크를 입력한 뒤 전처리 실행을 누르면 실제 얼굴 임베딩/FAISS 인덱싱을 시도합니다.</p>
          <Input name="title" placeholder="경기 제목" required />
          <Input
            name="source_url"
            type="url"
            placeholder="유튜브 링크 (예: https://www.youtube.com/watch?v=...)"
            disabled={Boolean(selectedVideoFile)}
          />
          <div className="file-picker">
            <input
              id="video-source-file"
              className="file-picker-input"
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm,image/jpeg,image/png,image/webp,image/bmp,.mp4,.mov,.mkv,.avi,.webm,.m4v,.jpg,.jpeg,.png,.webp,.bmp"
              onChange={handleVideoFileChange}
            />
            <Button asChild variant="secondary" className="file-picker-button">
              <label htmlFor="video-source-file">파일 찾기</label>
            </Button>
            <span>{selectedVideoFile?.name ?? "선택된 파일 없음"}</span>
          </div>
          {fileError ? <div className="field-error">{fileError}</div> : null}
          <Input name="home_team" placeholder="홈팀" defaultValue="LG" />
          <Input name="away_team" placeholder="원정팀" defaultValue="KIA" />
          <Input name="stadium" placeholder="구장" defaultValue="잠실야구장" />
          <Input name="broadcast" placeholder="방송사" defaultValue="KBO 중계" />
          <Button className="full">등록</Button>
        </form>
        <Card className="panel">
          <h2>분석 작업 큐</h2>
          <div className="admin-list">
            {videos.map((video) => (
              <article key={video.id} className={lastCreatedVideo?.id === video.id ? "new-item" : ""}>
                <div>
                  <strong>{video.title}</strong>
                  <span>{statusLabel(video.processing_status)} · {video.embeddings_indexed} embeddings · skip {video.skip_rate}%</span>
                  {video.source_url ? <em title={video.source_url}>{video.source_url}</em> : null}
                </div>
                <div className="row-actions">
                  <Button variant="secondary" onClick={() => processVideo(video.id)}>전처리 실행</Button>
                  <Button variant="destructive" onClick={() => deleteVideo(video.id)}>삭제</Button>
                </div>
              </article>
            ))}
          </div>
        </Card>
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
          <Input name="title" placeholder="캠페인명" required />
          <Input name="placement" placeholder="노출 위치" defaultValue="결과 미리보기" />
          <Input name="target_url" placeholder="클릭 URL" defaultValue="https://example.com" />
          <Input name="cta" placeholder="CTA" defaultValue="혜택 보기" />
          <Button className="full">광고 등록</Button>
        </form>
        <Card className="panel">
          <h2>캠페인 성과</h2>
          <div className="admin-list">
            {ads.map((ad) => (
              <article key={ad.id}>
                <div>
                  <strong>{ad.title}</strong>
                  <span>{ad.placement} · {ad.impressions} impressions · CTR {ad.ctr}%</span>
                </div>
                <Button variant="secondary">리포트</Button>
              </article>
            ))}
          </div>
        </Card>
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
    download_failed: "다운로드 실패",
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

import { useState } from "react";

const PLATFORMS = ["instagram", "tiktok", "twitter", "youtube", "linkedin", "facebook"];

const PLATFORM_COLORS = {
  instagram: "#E1306C",
  tiktok: "#010101",
  twitter: "#1DA1F2",
  youtube: "#FF0000",
  linkedin: "#0077B5",
  facebook: "#1877F2",
};

const PLATFORM_ICONS = {
  instagram: "📸",
  tiktok: "🎵",
  twitter: "🐦",
  youtube: "▶️",
  linkedin: "💼",
  facebook: "📘",
};

const MEDIA_TYPES = [
  { value: "text", label: "📝 Text only" },
  { value: "image", label: "🖼️ Image" },
  { value: "video", label: "🎬 Video" },
  { value: "carousel", label: "🎠 Carousel / Reel" },
];

function ScoreBar({ label, value, max = 20 }) {
  const pct = (value / max) * 100;
  const color = pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
        <span style={{ color: "#ccc" }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{value}/{max}</span>
      </div>
      <div style={{ background: "#333", borderRadius: 99, height: 6 }}>
        <div style={{ width: `${pct}%`, background: color, height: 6, borderRadius: 99, transition: "width 0.6s" }} />
      </div>
    </div>
  );
}

function InsightCard({ platform, data }) {
  if (!data) return null;
  return (
    <div style={{
      background: "#1a1a1a",
      border: `1px solid ${PLATFORM_COLORS[platform]}44`,
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ color: PLATFORM_COLORS[platform], fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
        {PLATFORM_ICONS[platform]} {platform.charAt(0).toUpperCase() + platform.slice(1)}
      </div>

      {data.headline && (
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 600, marginBottom: 12, lineHeight: 1.5 }}>
          {data.headline}
        </div>
      )}

      {data.patterns?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: "#93c5fd", fontWeight: 700, fontSize: 12, marginBottom: 4 }}>🔍 PATTERNS DECODED</div>
          {data.patterns.map((p, i) => <div key={i} style={{ color: "#ccc", fontSize: 13, marginBottom: 2 }}>• {p}</div>)}
        </div>
      )}

      {data.recommendation && (
        <div style={{ background: "#0f2f0f", border: "1px solid #22c55e44", borderRadius: 8, padding: 10 }}>
          <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 12, marginBottom: 4 }}>💡 RECOMMENDATION</div>
          <div style={{ color: "#dcfce7", fontSize: 13, lineHeight: 1.5 }}>{data.recommendation}</div>
        </div>
      )}
    </div>
  );
}

function VideoFrameCard({ frame, isBest }) {
  const score = frame.score ?? 0;
  const scoreColor = score >= 7 ? "#22c55e" : score >= 4 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{
      background: "#1a1a1a",
      border: isBest ? "2px solid #00b894" : "1px solid #333",
      borderRadius: 12,
      padding: 14,
      display: "flex",
      gap: 14,
      flexWrap: "wrap"
    }}>
      {frame.thumbnail && (
        <img src={frame.thumbnail} alt={`Frame at ${frame.timestamp}s`}
          style={{ width: 120, height: "auto", borderRadius: 8, flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>
            ⏱ {frame.timestamp}s {isBest && <span style={{ color: "#00b894" }}>· 🏆 Best Thumbnail</span>}
          </span>
          <span style={{
            background: scoreColor + "22", color: scoreColor, fontWeight: 800,
            fontSize: 14, borderRadius: 99, padding: "2px 10px"
          }}>{score}/10</span>
        </div>
        {frame.feedback && <div style={{ color: "#ccc", fontSize: 13, marginBottom: 4 }}>{frame.feedback}</div>}
        {frame.suggestion && (
          <div style={{ color: "#86efac", fontSize: 13 }}>💡 {frame.suggestion}</div>
        )}
      </div>
    </div>
  );
}

function PlatformCard({ platform, data }) {
  const [expanded, setExpanded] = useState(false);
  if (!data) return null;
  if (data.error) return (
    <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 12, padding: 16 }}>
      <div style={{ color: PLATFORM_COLORS[platform] }}>{PLATFORM_ICONS[platform]} {platform}</div>
      <div style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>Error fetching data</div>
    </div>
  );

  const score = data.overall_score || 0;
  const scoreColor = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{
      background: "#1a1a1a",
      border: `1px solid ${PLATFORM_COLORS[platform]}44`,
      borderRadius: 12,
      padding: 20,
      cursor: "pointer"
    }} onClick={() => setExpanded(!expanded)}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: PLATFORM_COLORS[platform], fontWeight: 700, fontSize: 16 }}>
          {PLATFORM_ICONS[platform]} {platform.charAt(0).toUpperCase() + platform.slice(1)}
        </div>
        <div style={{
          background: scoreColor + "22",
          color: scoreColor,
          fontWeight: 800,
          fontSize: 22,
          borderRadius: 99,
          padding: "4px 16px"
        }}>
          {score}/100
        </div>
      </div>

      {/* Score bar */}
      <div style={{ background: "#333", borderRadius: 99, height: 8, marginTop: 12 }}>
        <div style={{
          width: `${score}%`, background: scoreColor,
          height: 8, borderRadius: 99, transition: "width 0.8s"
        }} />
      </div>

      {/* Expand */}
      {expanded && (
        <div style={{ marginTop: 16 }}>
          {/* Sub scores */}
          {data.scores && (
            <div style={{ marginBottom: 16 }}>
              <ScoreBar label="Hook Strength" value={data.scores.hook} />
              <ScoreBar label="Copy Clarity" value={data.scores.clarity} />
              <ScoreBar label="CTA Presence" value={data.scores.cta} />
              <ScoreBar label="Format Fit" value={data.scores.format} />
              <ScoreBar label="Tone Match" value={data.scores.tone} />
            </div>
          )}

          {/* Rule flags */}
          {data.rule_flags?.length > 0 && (
            <div style={{ background: "#ef444422", border: "1px solid #ef4444", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ color: "#ef4444", fontWeight: 700, marginBottom: 6, fontSize: 13 }}>⚠️ Hard Rule Flags</div>
              {data.rule_flags.map((f, i) => <div key={i} style={{ color: "#fca5a5", fontSize: 13 }}>• {f}</div>)}
            </div>
          )}

          {/* Strengths */}
          {data.strengths?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>✅ Strengths</div>
              {data.strengths.map((s, i) => <div key={i} style={{ color: "#86efac", fontSize: 13 }}>• {s}</div>)}
            </div>
          )}

          {/* Weaknesses */}
          {data.weaknesses?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>⚠️ Weaknesses</div>
              {data.weaknesses.map((w, i) => <div key={i} style={{ color: "#fcd34d", fontSize: 13 }}>• {w}</div>)}
            </div>
          )}

          {/* Best time */}
          {data.best_time_to_post && (
            <div style={{ background: "#1e3a5f", borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <span style={{ color: "#93c5fd", fontSize: 13 }}>🕐 Best time: {data.best_time_to_post}</span>
            </div>
          )}

          {/* Hashtags */}
          {data.hashtag_suggestions?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>🏷️ Suggested Hashtags</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {data.hashtag_suggestions.map((h, i) => (
                  <span key={i} style={{
                    background: "#a78bfa22", color: "#c4b5fd",
                    borderRadius: 99, padding: "3px 10px", fontSize: 12
                  }}>{h}</span>
                ))}
              </div>
            </div>
          )}

          {/* Rewritten */}
          {data.rewritten && (
            <div style={{ background: "#0f2f0f", border: "1px solid #22c55e44", borderRadius: 8, padding: 12 }}>
              <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>✍️ AI-Rewritten Version</div>
              <div style={{ color: "#dcfce7", fontSize: 13, lineHeight: 1.6 }}>{data.rewritten}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ color: "#555", fontSize: 11, marginTop: 8, textAlign: "right" }}>
        {expanded ? "▲ collapse" : "▼ expand details"}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("scorer");
  const [draft, setDraft] = useState("");
  const [topic, setTopic] = useState("science innovation");
  const [platform, setPlatform] = useState("all");
  const [mediaType, setMediaType] = useState("text");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");

  const [videoFile, setVideoFile] = useState(null);
  const [videoResult, setVideoResult] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState("");

  const handleScore = async () => {
    if (!draft.trim()) return;
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("http://localhost:8000/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, topic, platform, media_type: mediaType })
      });
      const data = await res.json();
      setResults(data.results);
    } catch (e) {
      setError("Could not connect to backend. Make sure FastAPI is running.");
    }
    setLoading(false);
  };

  const handleInsights = async () => {
    setInsightsLoading(true);
    setInsightsError("");
    setInsights(null);
    try {
      const res = await fetch("http://localhost:8000/insights");
      const data = await res.json();
      setInsights(data);
    } catch (e) {
      setInsightsError("Could not connect to backend. Make sure FastAPI is running.");
    }
    setInsightsLoading(false);
  };

  const handleAnalyzeVideo = async () => {
    if (!videoFile) return;
    setVideoLoading(true);
    setVideoError("");
    setVideoResult(null);
    try {
      const formData = new FormData();
      formData.append("file", videoFile);
      formData.append("topic", topic);
      const res = await fetch("http://localhost:8000/analyze-video", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      setVideoResult(data);
    } catch (e) {
      setVideoError("Could not connect to backend. Make sure FastAPI is running.");
    }
    setVideoLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0d0d0d", color: "#fff",
      fontFamily: "'Inter', sans-serif", padding: "32px 24px"
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: "#00b894", letterSpacing: 3, marginBottom: 8 }}>
          QATAR SCIENCE & TECHNOLOGY PARK
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
          ⭐ Stars of Science
        </h1>
        <div style={{ color: "#888", marginTop: 6, fontSize: 15 }}>
          AI Content Scorer — Stop posting on instinct.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 32 }}>
        <button
          onClick={() => setTab("scorer")}
          style={{
            background: tab === "scorer" ? "linear-gradient(135deg, #00b894, #0984e3)" : "#1a1a1a",
            color: "#fff", border: "1px solid #333", borderRadius: 99,
            padding: "10px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer"
          }}
        >
          🚀 Pre-Publish Scorer
        </button>
        <button
          onClick={() => setTab("insights")}
          style={{
            background: tab === "insights" ? "linear-gradient(135deg, #00b894, #0984e3)" : "#1a1a1a",
            color: "#fff", border: "1px solid #333", borderRadius: 99,
            padding: "10px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer"
          }}
        >
          🧠 Account Intelligence
        </button>
        <button
          onClick={() => setTab("video")}
          style={{
            background: tab === "video" ? "linear-gradient(135deg, #00b894, #0984e3)" : "#1a1a1a",
            color: "#fff", border: "1px solid #333", borderRadius: 99,
            padding: "10px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer"
          }}
        >
          🎬 Video Analyzer
        </button>
      </div>

      {/* Input */}
      {tab === "scorer" && <div style={{
        background: "#1a1a1a", border: "1px solid #333",
        borderRadius: 16, padding: 24, maxWidth: 700, margin: "0 auto 32px"
      }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Paste your draft post here..."
          style={{
            width: "100%", minHeight: 120, background: "#111",
            border: "1px solid #444", borderRadius: 8, color: "#fff",
            padding: 14, fontSize: 14, resize: "vertical", boxSizing: "border-box"
          }}
        />

        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="Topic (e.g. science innovation)"
            style={{
              flex: 1, background: "#111", border: "1px solid #444",
              borderRadius: 8, color: "#fff", padding: "10px 14px", fontSize: 13
            }}
          />
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            style={{
              background: "#111", border: "1px solid #444",
              borderRadius: 8, color: "#fff", padding: "10px 14px", fontSize: 13
            }}
          >
            <option value="all">All Platforms</option>
            {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <select
            value={mediaType}
            onChange={e => setMediaType(e.target.value)}
            style={{
              background: "#111", border: "1px solid #444",
              borderRadius: 8, color: "#fff", padding: "10px 14px", fontSize: 13
            }}
          >
            {MEDIA_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        <button
          onClick={handleScore}
          disabled={loading || !draft.trim()}
          style={{
            width: "100%", marginTop: 14, padding: "14px",
            background: loading ? "#333" : "linear-gradient(135deg, #00b894, #0984e3)",
            color: "#fff", border: "none", borderRadius: 10,
            fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "⏳ Scoring across platforms..." : "🚀 Score My Post"}
        </button>

        {error && <div style={{ color: "#ef4444", marginTop: 12, fontSize: 13 }}>{error}</div>}
      </div>}

      {/* Results */}
      {tab === "scorer" && results && (
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{ color: "#888", fontSize: 13, marginBottom: 16, textAlign: "center" }}>
            Click any platform card to see full breakdown + rewrite
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {Object.entries(results).map(([plat, data]) => (
              <PlatformCard key={plat} platform={plat} data={data} />
            ))}
          </div>
        </div>
      )}

      {/* Account Intelligence */}
      {tab === "insights" && (
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{
            background: "#1a1a1a", border: "1px solid #333",
            borderRadius: 16, padding: 24, marginBottom: 24, textAlign: "center"
          }}>
            <div style={{ color: "#ccc", fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
              Decode what's actually driving engagement on Stars of Science's real accounts —
              powered by live RapidAPI data across all 6 platforms.
            </div>
            <button
              onClick={handleInsights}
              disabled={insightsLoading}
              style={{
                width: "100%", padding: "14px",
                background: insightsLoading ? "#333" : "linear-gradient(135deg, #00b894, #0984e3)",
                color: "#fff", border: "none", borderRadius: 10,
                fontSize: 16, fontWeight: 700, cursor: insightsLoading ? "not-allowed" : "pointer"
              }}
            >
              {insightsLoading ? "⏳ Decoding the algorithm..." : "🧠 Decode My Account"}
            </button>
            {insightsError && <div style={{ color: "#ef4444", marginTop: 12, fontSize: 13 }}>{insightsError}</div>}
          </div>

          {insights && (
            <>
              {insights.overall_strategy && (
                <div style={{
                  background: "#1e3a5f", border: "1px solid #3b82f644", borderRadius: 12,
                  padding: 18, marginBottom: 20
                }}>
                  <div style={{ color: "#93c5fd", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>📊 OVERALL STRATEGY</div>
                  <div style={{ color: "#dbeafe", fontSize: 14, lineHeight: 1.6 }}>{insights.overall_strategy}</div>
                </div>
              )}
              <div style={{ display: "grid", gap: 16 }}>
                {insights.platforms && Object.entries(insights.platforms).map(([plat, data]) => (
                  <InsightCard key={plat} platform={plat} data={data} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Video Analyzer */}
      {tab === "video" && (
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{
            background: "#1a1a1a", border: "1px solid #333",
            borderRadius: 16, padding: 24, marginBottom: 24
          }}>
            <div style={{ color: "#ccc", fontSize: 14, marginBottom: 16, lineHeight: 1.6, textAlign: "center" }}>
              Upload a video draft — AI samples frames across the timeline and flags which
              shots are weak, which would make a great thumbnail, and what to fix before you post.
            </div>

            <input
              type="file"
              accept="video/*"
              onChange={e => setVideoFile(e.target.files?.[0] || null)}
              style={{
                width: "100%", background: "#111", border: "1px solid #444",
                borderRadius: 8, color: "#fff", padding: "10px 14px", fontSize: 13,
                boxSizing: "border-box", marginBottom: 12
              }}
            />

            <button
              onClick={handleAnalyzeVideo}
              disabled={videoLoading || !videoFile}
              style={{
                width: "100%", padding: "14px",
                background: (videoLoading || !videoFile) ? "#333" : "linear-gradient(135deg, #00b894, #0984e3)",
                color: "#fff", border: "none", borderRadius: 10,
                fontSize: 16, fontWeight: 700, cursor: (videoLoading || !videoFile) ? "not-allowed" : "pointer"
              }}
            >
              {videoLoading ? "⏳ Analyzing frames..." : "🎬 Analyze My Video"}
            </button>
            {videoError && <div style={{ color: "#ef4444", marginTop: 12, fontSize: 13 }}>{videoError}</div>}
          </div>

          {videoResult?.error && (
            <div style={{ color: "#ef4444", textAlign: "center" }}>{videoResult.error}</div>
          )}

          {videoResult?.video_summary && (
            <div style={{
              background: "#1a1a1a", border: "1px solid #333", borderRadius: 12,
              padding: 16, marginBottom: 16
            }}>
              <div style={{ color: "#888", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>👁️ WHAT THE AI SAW</div>
              <div style={{ color: "#ccc", fontSize: 14, lineHeight: 1.6 }}>{videoResult.video_summary}</div>
            </div>
          )}

          {videoResult?.overall_verdict && (
            <div style={{
              background: "#1e3a5f", border: "1px solid #3b82f644", borderRadius: 12,
              padding: 18, marginBottom: 20
            }}>
              <div style={{ color: "#93c5fd", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>🎬 OVERALL VERDICT</div>
              <div style={{ color: "#dbeafe", fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>{videoResult.overall_verdict}</div>
              {videoResult.key_improvements?.length > 0 && (
                <div>
                  <div style={{ color: "#93c5fd", fontWeight: 700, fontSize: 12, marginBottom: 4 }}>🔑 KEY IMPROVEMENTS</div>
                  {videoResult.key_improvements.map((k, i) => <div key={i} style={{ color: "#dbeafe", fontSize: 13 }}>• {k}</div>)}
                </div>
              )}
            </div>
          )}

          {videoResult?.frames?.length > 0 && (
            <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
              {videoResult.frames.map((frame, i) => (
                <VideoFrameCard key={i} frame={frame} isBest={i === videoResult.best_thumbnail_index} />
              ))}
            </div>
          )}

          {videoResult?.platforms && (
            <>
              <div style={{ color: "#888", fontSize: 13, marginBottom: 16, textAlign: "center" }}>
                How this same video fits each platform
              </div>
              <div style={{ display: "grid", gap: 16 }}>
                {Object.entries(videoResult.platforms).map(([plat, data]) => (
                  <InsightCard key={plat} platform={plat} data={data} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

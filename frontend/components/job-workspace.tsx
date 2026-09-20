"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileCheck2,
  FileSearch,
  FileText,
  LoaderCircle,
  Menu,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from "react";

type Dimension = { name: string; score: number; note: string };
type Requirement = { label: string; status: "pass" | "missing"; evidence: string };
type Evidence = { skill: string; evidence: string };
type Gap = { skill: string; suggestion: string };
type Revision = {
  id: string;
  priority: "高" | "中" | "低";
  category: string;
  title: string;
  original: string;
  revised: string;
  reason: string;
};
type AnalyzeResult = {
  analysis_mode: "ai" | "local";
  score: number;
  verdict: string;
  dimensions: Dimension[];
  requirements: Requirement[];
  matched: Evidence[];
  gaps: Gap[];
  revisions: Revision[];
};
type ResumeFile = { filename: string; characters: number; text: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const sampleResume = `陈默｜Python 后端工程师｜3 年经验

电商订单系统
• 使用 FastAPI 重构订单服务 API，拆分核心模块并补充自动化测试
• 引入 Redis 缓存热点商品数据，接口响应时间降低 42%
• 使用 PostgreSQL 优化慢查询，订单报表生成时间从 18 秒降至 6 秒
• 通过 Docker 统一开发和部署环境，协助 4 人团队完成版本交付`;

const sampleJob = `岗位：Python 后端工程师

职责要求：
1. 负责核心业务服务的设计、开发与维护
2. 熟练掌握 Python，具有 FastAPI 或 Django 项目经验
3. 熟悉 PostgreSQL、Redis 和微服务架构
4. 熟悉 Docker、Kubernetes，有 AWS 使用经验优先
5. 具备良好的团队协作和问题定位能力`;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function JobWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [resume, setResume] = useState<ResumeFile | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [revisionStates, setRevisionStates] = useState<Record<string, "accepted" | "dismissed">>({});

  async function uploadResume(file: File) {
    setError("");
    setResult(null);
    setRevisionStates({});

    const suffix = file.name.toLowerCase().split(".").pop();
    if (!suffix || !["pdf", "docx"].includes(suffix)) {
      setError("仅支持 PDF 和 DOCX 简历。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("简历文件不能超过 5MB。");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_URL}/api/resume/extract`, { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "简历读取失败");
      setResume(body as ResumeFile);
    } catch (uploadError) {
      setError(errorMessage(uploadError, "简历读取失败，请稍后重试。"));
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadResume(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadResume(file);
  }

  function loadSample() {
    setResume({ filename: "示例-后端工程师简历.pdf", characters: sampleResume.length, text: sampleResume });
    setJobDescription(sampleJob);
    setResult(null);
    setRevisionStates({});
    setError("");
  }

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resume) return;

    setError("");
    setAnalyzing(true);
    setResult(null);
    setRevisionStates({});
    try {
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_text: resume.text, job_description: jobDescription }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "分析服务暂时不可用");
      setResult(body as AnalyzeResult);
    } catch (analysisError) {
      setError(errorMessage(analysisError, "无法连接分析服务，请确认后端已经启动。"));
    } finally {
      setAnalyzing(false);
    }
  }

  function setRevisionState(id: string, state: "accepted" | "dismissed") {
    setRevisionStates((current) => ({ ...current, [id]: state }));
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">JT</div>
          <div>
            <strong>JobTailor</strong>
            <span>简历诊断工作台</span>
          </div>
          <button className="icon-button sidebar-close" type="button" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}>
            <X size={19} />
          </button>
        </div>

        <nav className="workflow-nav" aria-label="分析步骤">
          <a className={resume ? "workflow-step complete" : "workflow-step current"} href="#source">
            <span>{resume ? <Check size={14} /> : "1"}</span>
            <div><strong>上传简历</strong><small>{resume ? "已提取文本" : "PDF 或 DOCX"}</small></div>
          </a>
          <a className={jobDescription.length >= 30 ? "workflow-step complete" : "workflow-step"} href="#jd-input">
            <span>{jobDescription.length >= 30 ? <Check size={14} /> : "2"}</span>
            <div><strong>输入岗位 JD</strong><small>识别要求与重点</small></div>
          </a>
          <a className={result ? "workflow-step complete" : "workflow-step"} href="#analysis">
            <span>{result ? <Check size={14} /> : "3"}</span>
            <div><strong>查看诊断</strong><small>匹配度与修改建议</small></div>
          </a>
        </nav>

        <div className="principle-note">
          <ShieldCheck size={18} />
          <div><strong>不编造经历</strong><p>建议只重组已有事实，缺口会明确标出。</p></div>
        </div>
      </aside>

      {mobileNavOpen ? <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} /> : null}

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}>
            <Menu size={20} />
          </button>
          <div>
            <p className="eyebrow">AI 简历诊断</p>
            <h1>让简历对准岗位，而不是堆关键词</h1>
          </div>
          <div className="privacy-state"><ShieldCheck size={15} /> 文件解析后不落盘</div>
        </header>

        <form className="analysis-grid" id="source" onSubmit={handleAnalyze}>
          <section className="source-panel">
            <div className="panel-heading">
              <div><span className="step-label">分析资料</span><h2>简历与目标岗位</h2></div>
              <button className="text-button" type="button" onClick={loadSample}>载入示例</button>
            </div>

            {resume ? (
              <div className="uploaded-file">
                <span className="file-icon"><FileCheck2 size={21} /></span>
                <div><strong>{resume.filename}</strong><small>已提取 {resume.characters} 个字符</small></div>
                <button className="icon-button" type="button" aria-label="移除简历" title="移除简历" onClick={() => { setResume(null); setResult(null); }}>
                  <Trash2 size={17} />
                </button>
              </div>
            ) : (
              <label
                className={`upload-zone ${dragActive ? "drag-active" : ""}`}
                onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" accept=".pdf,.docx" onChange={handleFileChange} />
                {uploading ? <LoaderCircle className="spin" size={24} /> : <UploadCloud size={24} />}
                <strong>{uploading ? "正在读取简历" : "上传简历"}</strong>
                <span>拖放或点击选择 PDF / DOCX，最大 5MB</span>
              </label>
            )}

            {resume ? (
              <details className="resume-preview">
                <summary><FileText size={15} /> 查看已提取文本 <ChevronDown size={15} /></summary>
                <pre>{resume.text}</pre>
              </details>
            ) : null}

            <label className="field text-field" id="jd-input">
              <span className="field-title"><span>目标岗位 JD</span><span>{jobDescription.length} 字</span></span>
              <textarea
                value={jobDescription}
                onChange={(event) => { setJobDescription(event.target.value); setResult(null); }}
                rows={11}
                minLength={30}
                placeholder="粘贴完整职位描述，包括职责、技能和经验要求"
                required
              />
            </label>

            {error ? <p className="error-message"><AlertTriangle size={16} />{error}</p> : null}

            <button className="primary-button" type="submit" disabled={!resume || jobDescription.trim().length < 30 || analyzing || uploading}>
              {analyzing ? <LoaderCircle className="spin" size={18} /> : <ScanSearch size={18} />}
              {analyzing ? "正在分析简历与岗位" : "开始匹配分析"}
              {analyzing ? null : <ArrowRight size={18} />}
            </button>
          </section>

          <section className="analysis-panel" id="analysis" aria-live="polite">
            {analyzing ? (
              <div className="analysis-loading">
                <span className="loading-mark"><Sparkles size={22} /></span>
                <h2>正在建立证据对应关系</h2>
                <div className="loading-steps">
                  <span className="done"><Check size={14} /> 读取简历内容</span>
                  <span className="active"><LoaderCircle className="spin" size={14} /> 对照岗位要求</span>
                  <span><CircleDashed size={14} /> 生成修改建议</span>
                </div>
              </div>
            ) : result ? (
              <>
                <div className="result-header">
                  <div><span className="step-label">{result.analysis_mode === "ai" ? "AI 分析" : "本地分析预览"}</span><h2>岗位匹配诊断</h2></div>
                  <div className="score-ring" style={{ "--score": `${result.score * 3.6}deg` } as React.CSSProperties}>
                    <strong>{result.score}</strong><span>匹配度</span>
                  </div>
                </div>
                <p className="verdict">{result.verdict}</p>

                <div className="dimension-list">
                  {result.dimensions.map((dimension) => (
                    <div className="dimension" key={dimension.name}>
                      <div><strong>{dimension.name}</strong><span>{dimension.score}</span></div>
                      <div className="dimension-track"><span style={{ width: `${dimension.score}%` }} /></div>
                      <small>{dimension.note}</small>
                    </div>
                  ))}
                </div>

                <div className="requirements-block">
                  <div className="section-heading"><h3>硬性要求</h3><span>{result.requirements.filter((item) => item.status === "pass").length}/{result.requirements.length} 已覆盖</span></div>
                  <div className="requirement-list">
                    {result.requirements.map((item) => (
                      <div className={`requirement ${item.status}`} key={item.label}>
                        {item.status === "pass" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                        <div><strong>{item.label}</strong><small>{item.evidence}</small></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="evidence-summary">
                  <div><span className="summary-number success-number">{result.matched.length}</span><span>有证据支撑</span></div>
                  <div><span className="summary-number warning-number">{result.gaps.length}</span><span>需要确认</span></div>
                </div>
              </>
            ) : (
              <div className="analysis-empty">
                <span className="empty-mark"><FileSearch size={25} /></span>
                <h2>分析结果会显示在这里</h2>
                <p>上传简历并输入岗位 JD 后，系统会从匹配度、经历证据、岗位相关性和表达清晰度四个方面进行诊断。</p>
              </div>
            )}
          </section>
        </form>

        {result ? (
          <section className="suggestions-section" id="suggestions">
            <div className="suggestions-heading">
              <div><span className="step-label">修改建议</span><h2>按影响程度逐条处理</h2></div>
              <span className="suggestion-count">{result.revisions.length} 条建议</span>
            </div>
            <div className="revision-list">
              {result.revisions.map((revision) => {
                const state = revisionStates[revision.id];
                return (
                  <article className={`revision-item ${state ? `revision-${state}` : ""}`} key={revision.id}>
                    <div className="revision-meta">
                      <span className={`priority priority-${revision.priority}`}>{revision.priority}优先级</span>
                      <span>{revision.category}</span>
                    </div>
                    <div className="revision-content">
                      <div className="revision-title"><h3>{revision.title}</h3><p>{revision.reason}</p></div>
                      <div className="comparison-grid">
                        <div className="comparison original-copy"><span>当前内容</span><p>{revision.original}</p></div>
                        <div className="comparison revised-copy"><span>建议调整</span><p>{revision.revised}</p></div>
                      </div>
                    </div>
                    <div className="revision-actions">
                      {state ? (
                        <span className={`decision decision-${state}`}>
                          {state === "accepted" ? <Check size={16} /> : <X size={16} />}
                          {state === "accepted" ? "已采纳" : "已跳过"}
                        </span>
                      ) : (
                        <>
                          <button className="action-button" type="button" onClick={() => setRevisionState(revision.id, "dismissed")}><X size={16} />跳过</button>
                          <button className="action-button accept-button" type="button" onClick={() => setRevisionState(revision.id, "accepted")}><Check size={16} />采纳</button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

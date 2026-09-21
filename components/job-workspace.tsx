"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  LoaderCircle,
  Menu,
  MessageSquare,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  UploadCloud,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";

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

const API_URL = "";

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
  const suggestionsRef = useRef<HTMLElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [resume, setResume] = useState<ResumeFile | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [revisionStates, setRevisionStates] = useState<Record<string, "accepted" | "dismissed">>({});
  const [generatedResume, setGeneratedResume] = useState("");
  const [resumeHistory, setResumeHistory] = useState<string[]>([]);
  const [aiInstruction, setAiInstruction] = useState("");
  const [generatingResume, setGeneratingResume] = useState(false);
  const [refiningResume, setRefiningResume] = useState(false);
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);

  const acceptedRevisions = result?.revisions.filter((revision) => revisionStates[revision.id] === "accepted") ?? [];

  useEffect(() => {
    if (result?.revisions.length === 1) {
      suggestionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result?.revisions.length]);

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
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "分析服务暂时不可用");
      }
      if (!response.body) throw new Error("分析服务没有返回数据流");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const streamEvent = JSON.parse(line) as { type: "summary" | "revision" | "done" | "error"; data?: AnalyzeResult | Revision; detail?: string };
          if (streamEvent.type === "summary") {
            const summary = streamEvent.data as AnalyzeResult;
            setResult({ ...summary, analysis_mode: summary.analysis_mode ?? "ai", revisions: [] });
          } else if (streamEvent.type === "revision") {
            setResult((current) => current ? { ...current, revisions: [...current.revisions, streamEvent.data as Revision] } : current);
          } else if (streamEvent.type === "error") {
            throw new Error(streamEvent.detail ?? "流式分析失败");
          }
        }
        if (done) break;
      }
    } catch (analysisError) {
      setError(errorMessage(analysisError, "无法连接分析服务，请确认后端已经启动。"));
    } finally {
      setAnalyzing(false);
    }
  }

  function setRevisionState(id: string, state: "accepted" | "dismissed") {
    setRevisionStates((current) => ({ ...current, [id]: state }));
  }

  async function regenerateResume() {
    if (!resume || !acceptedRevisions.length) return;
    setGeneratingResume(true);
    setError("");
    try {
      const response = await fetch("/api/resume/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original: resume.text, revisions: acceptedRevisions }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "简历生成失败");
      setResumeHistory([]);
      setGeneratedResume(body.content);
      requestAnimationFrame(() => document.querySelector("#resume-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (generateError) {
      setError(errorMessage(generateError, "简历生成失败"));
    } finally {
      setGeneratingResume(false);
    }
  }

  async function refineGeneratedResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!generatedResume || !aiInstruction.trim()) return;
    setRefiningResume(true);
    setError("");
    try {
      const response = await fetch("/api/resume/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: generatedResume, instruction: aiInstruction }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "AI 修改失败");
      setResumeHistory((history) => [...history, generatedResume]);
      setGeneratedResume(body.content);
      setAiInstruction("");
    } catch (refineError) {
      setError(errorMessage(refineError, "AI 修改失败"));
    } finally {
      setRefiningResume(false);
    }
  }

  function undoResumeChange() {
    setResumeHistory((history) => {
      const previous = history.at(-1);
      if (previous) setGeneratedResume(previous);
      return history.slice(0, -1);
    });
  }

  async function downloadResume(format: "docx" | "pdf") {
    if (!generatedResume || !resume) return;
    setExporting(format);
    try {
      const response = await fetch("/api/resume/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: generatedResume, format, filename: resume.filename }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "文件导出失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${resume.filename.replace(/\.(pdf|docx)$/i, "")}-优化版.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(errorMessage(exportError, "文件导出失败"));
    } finally {
      setExporting(null);
    }
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
              <span className="button-icon">{analyzing ? <LoaderCircle className="spin" size={18} /> : <ScanSearch size={18} />}</span>
              <span>{analyzing ? "正在分析简历与岗位" : "开始匹配分析"}</span>
              <span className="button-icon">{analyzing ? null : <ArrowRight size={18} />}</span>
            </button>
          </section>

          <section className="analysis-panel" id="analysis" aria-live="polite">
            {analyzing && !result ? (
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
          <section className="suggestions-section suggestions-enter" id="suggestions" ref={suggestionsRef}>
            <div className="suggestions-heading">
              <div><span className="step-label">修改建议</span><h2>按影响程度逐条处理</h2></div>
              <span className="suggestion-count">{analyzing ? `已生成 ${result.revisions.length} 条` : `${result.revisions.length} 条建议`}</span>
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
            <div className="regenerate-bar">
              <div><strong>{acceptedRevisions.length} 条建议已采纳</strong><span>重新生成时只应用已采纳内容，原始事实会保留。</span></div>
              <button className="primary-button regenerate-button" type="button" disabled={!acceptedRevisions.length || generatingResume} onClick={regenerateResume}>
                <span className="button-icon">{generatingResume ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}</span>
                <span>{generatingResume ? "正在重新生成" : "重新生成简历"}</span>
                <span className="button-icon" />
              </button>
            </div>
          </section>
        ) : null}

        {generatedResume ? (
          <section className="resume-editor-section suggestions-enter" id="resume-editor">
            <div className="suggestions-heading">
              <div><span className="step-label">优化版简历</span><h2>检查、修改并下载</h2></div>
              <button className="action-button" type="button" disabled={!resumeHistory.length} onClick={undoResumeChange}><Undo2 size={16} />撤销上一步</button>
            </div>
            <div className="editor-grid">
              <label className="resume-document">
                <span>可直接编辑正文</span>
                <textarea value={generatedResume} onChange={(event) => setGeneratedResume(event.target.value)} aria-label="优化版简历正文" />
              </label>
              <aside className="ai-refine-panel">
                <div><MessageSquare size={18} /><strong>继续让 AI 修改</strong></div>
                <p>点名某一段时只改该段；明确说“整体调整”时才会修改全文。</p>
                <form onSubmit={refineGeneratedResume}>
                  <textarea value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder="例如：把第二段写得更简洁，保留所有数据" aria-label="AI 修改要求" />
                  <button className="primary-button" type="submit" disabled={!aiInstruction.trim() || refiningResume}>
                    <span className="button-icon">{refiningResume ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}</span>
                    <span>{refiningResume ? "正在修改" : "应用 AI 修改"}</span>
                    <span className="button-icon" />
                  </button>
                </form>
                <div className="download-actions">
                  <button className="action-button" type="button" disabled={Boolean(exporting)} onClick={() => downloadResume("docx")}><Download size={16} />{exporting === "docx" ? "生成中" : "下载 DOCX"}</button>
                  <button className="action-button accept-button" type="button" disabled={Boolean(exporting)} onClick={() => downloadResume("pdf")}><Download size={16} />{exporting === "pdf" ? "生成中" : "下载 PDF"}</button>
                </div>
              </aside>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

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
import { parseAnalysisEvent } from "@/lib/analysis-validation";
import { reviewResumeChanges } from "@/lib/resume-review";

type Dimension = { name: string; score: number | null; note: string };
type Requirement = { label: string; status: "pass" | "missing"; evidence: string; importance?: "required" | "preferred" };
type Evidence = { skill: string; evidence: string };
type Gap = { skill: string; suggestion: string };
type Revision = {
  kind?: "replacement" | "reminder";
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
  score: number | null;
  scope_note?: string;
  verdict: string;
  dimensions: Dimension[];
  requirements: Requirement[];
  matched: Evidence[];
  gaps: Gap[];
  revisions: Revision[];
};
type ResumeFile = { filename: string; characters: number; text: string };
type ResumeDraft = { content: string; resume: ResumeFile; jobDescription: string };
type PendingDraft = ResumeDraft & { operation?: "refine"; complete?: boolean };
type ServiceInfo = { analysis_mode: "ai" | "local"; usage_limits?: { perClientRequests: number; clientWindowSeconds: number; perClientConcurrent: number; globalRequests: number; globalWindowSeconds: number; globalConcurrent: number } };
type WorkPhase = { label: string; detail: string; icon: "scan" | "spark" | "write" | "check" };

const API_URL = "";
const DRAFT_STORAGE_KEY = "jobtailor:draft:v1";

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

function isResumeDraft(value: unknown): value is ResumeDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResumeDraft>;
  return typeof candidate.content === "string" && Boolean(candidate.content.trim())
    && typeof candidate.jobDescription === "string" && typeof candidate.resume?.filename === "string"
    && typeof candidate.resume.text === "string" && typeof candidate.resume.characters === "number";
}

async function readResumeResponse(response: Response): Promise<ResumeFile> {
  const rawBody = await response.text();
  let body: Partial<ResumeFile> & { detail?: unknown } = {};

  if (rawBody.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        body = parsed as Partial<ResumeFile> & { detail?: unknown };
      } else if (response.ok) {
        throw new Error("简历读取失败：服务返回了无法识别的数据。");
      }
    } catch {
      if (response.ok) throw new Error("简历读取失败：服务返回了无法识别的数据。");
    }
  }

  if (!response.ok) {
    if (typeof body.detail === "string" && body.detail.trim()) throw new Error(body.detail);
    if (response.status === 413) throw new Error("上传失败：服务器拒绝了文件大小，请上传更小的简历。");
    throw new Error(`简历读取服务暂时不可用（HTTP ${response.status}），请稍后重试。`);
  }

  if (typeof body.filename !== "string" || typeof body.characters !== "number" || typeof body.text !== "string") {
    throw new Error("简历读取失败：服务没有返回完整的简历内容。");
  }

  return body as ResumeFile;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    const response = await fetch(input, { ...init, signal });
    if (!response.body) {
      window.clearTimeout(timer);
      return response;
    }
    const reader = response.body.getReader();
    return new Response(new ReadableStream({
      async pull(stream) {
        try {
          const { done, value } = await reader.read();
          if (done) { window.clearTimeout(timer); stream.close(); }
          else stream.enqueue(value);
        } catch (error) {
          window.clearTimeout(timer);
          stream.error(controller.signal.aborted ? new Error("请求等待时间过长，请稍后重试。") : error);
        }
      },
      async cancel(reason) {
        window.clearTimeout(timer);
        controller.abort();
        await reader.cancel(reason);
      },
    }), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    window.clearTimeout(timer);
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("请求等待时间过长，模型服务可能暂时繁忙。请稍后重试。");
    throw error;
  }
}

async function readTextStream(response: Response, onText: (text: string) => void) {
  if (!response.body) throw new Error("服务没有返回可读取的数据流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      content += decoder.decode(value, { stream: !done });
      onText(content);
    }
    if (done) break;
  }
  return content.trim();
}

const analysisPhases: WorkPhase[] = [
  { label: "读取简历内容", detail: "提取可验证的经历和技术关键词", icon: "scan" },
  { label: "拆解岗位要求", detail: "把 JD 拆成技能、职责和证据点", icon: "spark" },
  { label: "核对证据关系", detail: "只保留简历中能找到依据的匹配", icon: "write" },
  { label: "整理修改建议", detail: "按影响程度逐条生成建议", icon: "check" },
];

function PhaseGlyph({ icon }: { icon: WorkPhase["icon"] }) {
  return <svg className="phase-glyph" viewBox="0 0 48 48" aria-hidden="true"><circle className="phase-orbit" cx="24" cy="24" r="17" /><path className="phase-stroke" d={icon === "scan" ? "M15 18h18M15 24h12M15 30h9" : icon === "spark" ? "m24 10 2.5 8.5L35 21l-8.5 2.5L24 32l-2.5-8.5L13 21l8.5-2.5L24 10Z" : icon === "write" ? "m15 31 3.2-8.4L30 11l7 7-11.8 11.8L15 31Z" : "m14 25 6 6 14-15"} /></svg>;
}

export function JobWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLElement>(null);
  const analysisVersionRef = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);
  const uploadVersionRef = useRef(0);
  const refineBaseRef = useRef<ResumeDraft | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [resume, setResume] = useState<ResumeFile | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [revisionStates, setRevisionStates] = useState<Record<string, "accepted" | "dismissed">>({});
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
  const [resumeHistory, setResumeHistory] = useState<ResumeDraft[]>([]);
  const [saveDraftLocally, setSaveDraftLocally] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [generatingResume, setGeneratingResume] = useState(false);
  const [refiningResume, setRefiningResume] = useState(false);
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState(0);
  const [generationPhase, setGenerationPhase] = useState(0);
  const [refinePhase, setRefinePhase] = useState(0);

  const generatedResume = draft?.content ?? "";
  const editorBusy = generatingResume || refiningResume;
  const draftMatchesInput = Boolean(draft && resume && draft.resume.text === resume.text && draft.resume.filename === resume.filename && draft.jobDescription === jobDescription);
  const acceptedRevisions = result?.revisions.filter((revision) => revision.kind !== "reminder" && revisionStates[revision.id] === "accepted") ?? [];
  const pendingReview = pendingDraft ? reviewResumeChanges(generatedResume, pendingDraft.content) : null;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal }).then((response) => response.json()).then((info) => {
      if (!controller.signal.aborted && (info.analysis_mode === "ai" || info.analysis_mode === "local")) setServiceInfo(info);
    }).catch(() => { /* The workflow remains available when service information cannot be loaded. */ });
    return () => {
      controller.abort();
      analysisAbortRef.current?.abort();
      refineAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!saveDraftLocally || !draft) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, draft: refineBaseRef.current ?? draft, previous: resumeHistory.at(-1) }));
      } catch {
        setSaveDraftLocally(false);
        setError("本机草稿保存失败，当前内容仍在编辑区，请及时下载。");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, saveDraftLocally, resumeHistory, refiningResume]);

  useEffect(() => {
    if (!draft) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (saveDraftLocally) {
        try {
          localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, draft: refineBaseRef.current ?? draft, previous: resumeHistory.at(-1) }));
          return;
        } catch { /* Warn before leaving if the latest draft cannot be saved. */ }
      }
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [draft, saveDraftLocally, resumeHistory]);

  function invalidateAnalysis() {
    analysisVersionRef.current++;
    analysisAbortRef.current?.abort();
    setAnalysisComplete(false);
    setResult(null);
    setRevisionStates({});
    setAnalyzing(false);
    setPendingDraft(null);
    setSuccessMessage("");
  }

  function applyDraft(next: ResumeDraft) {
    if (!next.content.trim()) {
      setError("新版本没有可用正文，原稿保持不变。");
      return;
    }
    if (draft) setResumeHistory((history) => [...history, draft]);
    setDraft({ content: next.content, resume: next.resume, jobDescription: next.jobDescription });
    setPendingDraft(null);
    setAiInstruction("");
    setSuccessMessage("优化版简历已生成，可以直接编辑或下载。");
  }

  function restoreLocalDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? "null");
      const restored = saved?.draft;
      if (saved?.version !== 1 || !isResumeDraft(restored)) {
        throw new Error("没有找到可恢复的本机草稿。");
      }
      setError("");
      if (draft) {
        setPendingDraft(restored);
      } else {
        uploadVersionRef.current++;
        setUploading(false);
        invalidateAnalysis();
        setResume(restored.resume);
        setJobDescription(restored.jobDescription);
        applyDraft(restored);
        setResumeHistory(isResumeDraft(saved.previous) ? [saved.previous] : []);
        setSuccessMessage("本机草稿已恢复，可以继续编辑或下载。");
      }
    } catch (restoreError) {
      setError(errorMessage(restoreError, "本机草稿暂时无法读取。"));
    }
  }

  useEffect(() => {
    if (!analyzing) return;
    const timer = window.setInterval(() => setAnalysisPhase((phase) => phase >= 2 ? phase : phase + 1), 20_000);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  useEffect(() => {
    if (!generatingResume) return;
    const timer = window.setInterval(() => setGenerationPhase((phase) => Math.min(phase + 1, 2)), 2600);
    return () => window.clearInterval(timer);
  }, [generatingResume]);

  useEffect(() => {
    if (!refiningResume) return;
    const timer = window.setInterval(() => setRefinePhase((phase) => Math.min(phase + 1, 2)), 2600);
    return () => window.clearInterval(timer);
  }, [refiningResume]);

  useEffect(() => {
    if (result?.revisions.length === 1) {
      suggestionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result?.revisions.length]);

  async function uploadResume(file: File) {
    if (editorBusy) return;
    const uploadVersion = ++uploadVersionRef.current;
    setUploading(false);
    setError("");
    setSuccessMessage("");
    invalidateAnalysis();

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
      const uploaded = await readResumeResponse(response);
      if (uploadVersion === uploadVersionRef.current) setResume(uploaded);
    } catch (uploadError) {
      if (uploadVersion === uploadVersionRef.current) setError(errorMessage(uploadError, "简历读取失败，请稍后重试。"));
    } finally {
      if (uploadVersion === uploadVersionRef.current) setUploading(false);
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
    uploadVersionRef.current++;
    setUploading(false);
    invalidateAnalysis();
    setResume({ filename: "示例-后端工程师简历.pdf", characters: sampleResume.length, text: sampleResume });
    setJobDescription(sampleJob);
    setError("");
  }

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resume || editorBusy) return;
    const analysisVersion = ++analysisVersionRef.current;
    const controller = new AbortController();
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = controller;

    setError("");
    setAnalysisPhase(0);
    setAnalyzing(true);
    setAnalysisComplete(false);
    setResult(null);
    setRevisionStates({});
    try {
      const response = await fetchWithTimeout(`${API_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_text: resume.text, job_description: jobDescription }),
        signal: controller.signal,
      }, 180_000);
      if (analysisVersion !== analysisVersionRef.current) {
        await response.body?.cancel();
        return;
      }
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "分析服务暂时不可用");
      }
      if (!response.body) throw new Error("分析服务没有返回数据流");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedSummary = false;
      let receivedDone = false;
      const revisionIds = new Set<string>();
      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const streamEvent = parseAnalysisEvent(JSON.parse(line));
        if (receivedDone) throw new Error("分析完成后收到多余数据，请重试。");
        if (streamEvent.type === "summary") {
          if (receivedSummary) throw new Error("分析重复返回诊断摘要，请重试。");
          receivedSummary = true;
          setAnalysisPhase(3);
          setResult({ ...streamEvent.data, revisions: [] });
        } else if (streamEvent.type === "revision") {
          if (!receivedSummary || revisionIds.has(streamEvent.data.id)) throw new Error("修改建议顺序异常或重复，请重试。");
          revisionIds.add(streamEvent.data.id);
          setResult((current) => current ? { ...current, revisions: [...current.revisions, streamEvent.data] } : current);
        } else if (streamEvent.type === "error") {
          throw new Error(streamEvent.detail);
        } else {
          if (!receivedSummary) throw new Error("分析没有返回完整诊断，请重试。");
          receivedDone = true;
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (analysisVersion !== analysisVersionRef.current) {
          await reader.cancel();
          return;
        }
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
        if (done) break;
      }
      if (buffer.trim()) consumeLine(buffer);
      if (!receivedSummary || !receivedDone) throw new Error("分析结果未完整返回，请重新分析；当前草稿未受影响。");
      setAnalysisComplete(true);
    } catch (analysisError) {
      if (analysisVersion === analysisVersionRef.current) setError(errorMessage(analysisError, "无法连接分析服务，请确认后端已经启动。"));
    } finally {
      if (analysisVersion === analysisVersionRef.current) setAnalyzing(false);
    }
  }

  function setRevisionState(id: string, state?: "accepted" | "dismissed") {
    setRevisionStates((current) => {
      const next = { ...current };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
    setPendingDraft(null);
    setSuccessMessage(state === "accepted" ? "建议已选中，点击“重新生成简历”后写入正文。" : "");
  }

  async function regenerateResume() {
    if (!resume || !acceptedRevisions.length || editorBusy || !analysisComplete) return;
    setGenerationPhase(0);
    setGeneratingResume(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetchWithTimeout("/api/resume/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original: resume.text, revisions: acceptedRevisions }),
      }, 180_000);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "简历生成失败");
      }
      const content = await readTextStream(response, () => {});
      if (!content) throw new Error("模型没有返回简历内容");
      const cleaned = content.replace(/^```(?:text|markdown)?\s*|\s*```$/g, "").trim();
      if (!cleaned) throw new Error("生成结果没有可用正文，请重试。");
      const nextDraft = { content: cleaned, resume, jobDescription };
      if (draft) {
        setPendingDraft(nextDraft);
        setSuccessMessage("新版本已准备好，请对照后决定是否替换当前草稿。");
      } else {
        applyDraft(nextDraft);
      }
      requestAnimationFrame(() => document.querySelector("#resume-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (generateError) {
      setError(`${errorMessage(generateError, "简历生成失败")} 编辑区仍保留上一次版本。`);
    } finally {
      setGeneratingResume(false);
    }
  }

  async function refineGeneratedResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !generatedResume || !aiInstruction.trim() || editorBusy || pendingDraft) return;
    refineBaseRef.current = draft;
    const controller = new AbortController();
    refineAbortRef.current = controller;
    setPendingDraft(null);
    setRefinePhase(0);
    setRefiningResume(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetchWithTimeout("/api/resume/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: generatedResume, instruction: aiInstruction }),
        signal: controller.signal,
      }, 180_000);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "AI 修改失败");
      }
      const content = await readTextStream(response, (text) => setPendingDraft({ ...draft, content: text, operation: "refine", complete: false }));
      const cleaned = content.replace(/^```(?:text|markdown)?\s*|\s*```$/g, "").trim();
      if (!cleaned) throw new Error("AI 修改结果没有可用正文，请重试。");
      setPendingDraft({ ...draft, content: cleaned, operation: "refine", complete: true });
      setSuccessMessage("AI 修改预览已准备好，请核对改动后再替换当前草稿。");
    } catch (refineError) {
      if (controller.signal.aborted) setPendingDraft(null);
      setError(`${controller.signal.aborted ? "本次 AI 修改已取消。" : errorMessage(refineError, "AI 修改未完成")} 原稿保持不变，未完成的预览不能应用。`);
    } finally {
      refineBaseRef.current = null;
      setRefiningResume(false);
    }
  }

  function undoResumeChange() {
    if (editorBusy) return;
    const previous = resumeHistory.at(-1);
    if (!previous) return;
    setDraft(previous);
    setResumeHistory((history) => history.slice(0, -1));
    setPendingDraft(null);
  }

  async function downloadResume(format: "docx" | "pdf") {
    if (!draft || !generatedResume.trim() || editorBusy) return;
    setExporting(format);
    try {
      const response = await fetch("/api/resume/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: generatedResume, format, filename: draft.resume.filename }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "文件导出失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draft.resume.filename.replace(/\.(pdf|docx)$/i, "")}-优化版.${format}`;
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
          <div className="privacy-state"><ShieldCheck size={15} /> 原文件仅在内存解析</div>
        </header>

        <form className="analysis-grid" id="source" onSubmit={handleAnalyze}>
          <section className="source-panel">
            <div className="panel-heading">
              <div><span className="step-label">分析资料</span><h2>简历与目标岗位</h2></div>
              <div className="draft-controls">
                <button className="text-button" type="button" disabled={editorBusy} onClick={restoreLocalDraft}>恢复本机草稿</button>
                <button className="text-button" type="button" disabled={editorBusy} onClick={loadSample}>载入示例</button>
              </div>
            </div>

            {resume ? (
              <div className="uploaded-file">
                <span className="file-icon"><FileCheck2 size={21} /></span>
                <div><strong>{resume.filename}</strong><small>已提取 {resume.characters} 个字符</small></div>
                <button className="icon-button" type="button" disabled={editorBusy} aria-label="移除简历" title="移除简历" onClick={() => { uploadVersionRef.current++; setUploading(false); setResume(null); invalidateAnalysis(); }}>
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
                <input ref={fileInputRef} type="file" accept=".pdf,.docx" disabled={editorBusy} onChange={handleFileChange} />
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
                onChange={(event) => { setJobDescription(event.target.value); invalidateAnalysis(); }}
                disabled={editorBusy}
                rows={11}
                minLength={30}
                maxLength={20_000}
                placeholder="粘贴完整职位描述，包括职责、技能和经验要求"
                required
              />
            </label>

            <details className="privacy-details">
              <summary>数据如何使用与使用限额</summary>
              <p>{serviceInfo?.analysis_mode === "local" ? "当前为本地分析预览，简历和岗位文本不会发送给模型服务。" : serviceInfo?.analysis_mode === "ai" ? "当前已启用 AI 分析。开始分析后，简历提取文字和目标岗位描述会发送给站点配置的模型服务。" : "启用 AI 时，开始分析会将简历提取文字和目标岗位描述发送给站点配置的模型服务；本地预览不会发送。"}</p>
              <p>继续让 AI 修改时，会发送当前草稿和本次修改要求。原文件仅用于服务器内存解析；下载导出不调用模型。请在操作前移除不希望发送的个人信息。</p>
              <p>本机草稿默认关闭，勾选保存后仅保存在当前浏览器，可随时清除。</p>
              {serviceInfo?.usage_limits ? <p>每个浏览器每 {serviceInfo.usage_limits.clientWindowSeconds / 60} 分钟最多 {serviceInfo.usage_limits.perClientRequests} 次 AI 请求，同时最多 {serviceInfo.usage_limits.perClientConcurrent} 次。站点每小时最多 {serviceInfo.usage_limits.globalRequests} 次，同时最多 {serviceInfo.usage_limits.globalConcurrent} 次；达到限额时会提示稍后重试。</p> : <p>服务设有请求频率、长度和同时处理数量限制，达到限额时会提示重试时间。</p>}
            </details>

            {error ? <p className="error-message"><AlertTriangle size={16} />{error}</p> : null}
            {successMessage ? <p className="success-message"><CheckCircle2 size={16} />{successMessage}</p> : null}

            <button className="primary-button" type="submit" disabled={!resume || jobDescription.trim().length < 30 || analyzing || uploading || editorBusy}>
              <span className="button-icon">{analyzing ? <LoaderCircle className="spin" size={18} /> : <ScanSearch size={18} />}</span>
              <span>{analyzing ? "正在分析简历与岗位" : "开始匹配分析"}</span>
              <span className="button-icon">{analyzing ? null : <ArrowRight size={18} />}</span>
            </button>
            {analyzing ? <button className="text-button" type="button" onClick={() => { invalidateAnalysis(); setSuccessMessage("分析已取消。"); }}>取消分析</button> : null}
          </section>

          <section className="analysis-panel" id="analysis" aria-live="polite">
            {analyzing && !result ? (
              <div className="analysis-loading">
                <div className="phase-visual"><PhaseGlyph icon={analysisPhases[analysisPhase].icon} /><span className="phase-pulse" /></div>
                <h2>{analysisPhases[analysisPhase].label}</h2>
                <p className="phase-detail">{analysisPhases[analysisPhase].detail}</p>
                <div className="phase-progress" aria-label="分析进度">{analysisPhases.map((phase, index) => <span key={phase.label} className={index <= analysisPhase ? "phase-active" : ""} />)}</div>
                <div className="loading-steps">{analysisPhases.map((phase, index) => <span key={phase.label} className={index < analysisPhase ? "done" : index === analysisPhase ? "active" : ""}>{index < analysisPhase ? <Check size={14} /> : index === analysisPhase ? <LoaderCircle className="spin" size={14} /> : <CircleDashed size={14} />} {phase.label}</span>)}</div>
              </div>
            ) : result ? (
              <>
                <div className="result-header">
                  <div><span className="step-label">{result.analysis_mode === "ai" ? "AI 分析" : "本地分析预览"}</span><h2>岗位匹配诊断</h2></div>
                  <div className="score-ring" style={{ "--score": `${(result.score ?? 0) * 3.6}deg` } as React.CSSProperties}>
                    <strong>{result.score ?? "—"}</strong><span>{result.score === null ? "暂不评分" : "匹配度"}</span>
                  </div>
                </div>
                <p className="verdict">{result.verdict}</p>
                {result.scope_note ? <p className="scope-note">{result.scope_note}</p> : null}
                {!analyzing && !analysisComplete ? <p className="error-message" role="status">分析未完成，已有内容仅供查看，请重试后再生成。</p> : null}

                <div className="dimension-list">
                  {result.dimensions.map((dimension) => (
                    <div className="dimension" key={dimension.name}>
                      <div><strong>{dimension.name}</strong><span>{dimension.score ?? "—"}</span></div>
                      <div className="dimension-track"><span style={{ width: `${dimension.score ?? 0}%` }} /></div>
                      <small>{dimension.note}</small>
                    </div>
                  ))}
                </div>

                <div className="requirements-block">
                  <div className="section-heading"><h3>岗位要求</h3><span>{result.requirements.filter((item) => item.status === "pass").length}/{result.requirements.length} 已覆盖</span></div>
                  <div className="requirement-list">
                    {result.requirements.map((item) => (
                      <div className={`requirement ${item.status}`} key={item.label}>
                        {item.status === "pass" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                        <div><strong>{item.label} <span className="requirement-importance">{item.importance === "preferred" ? "加分" : "必需"}</span></strong><small>{item.evidence}</small></div>
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
                      {revision.kind === "reminder" ? <span>待补充提醒</span> : null}
                    </div>
                    <div className="revision-content">
                      <div className="revision-title"><h3>{revision.title}</h3><p>{revision.reason}</p></div>
                      <div className="comparison-grid">
                        <div className="comparison original-copy"><span>{revision.kind === "reminder" ? "当前情况" : "当前内容"}</span><p>{revision.original}</p></div>
                        <div className="comparison revised-copy"><span>{revision.kind === "reminder" ? "补充方向（不会直接写入正文）" : "建议调整"}</span><p>{revision.revised}</p></div>
                      </div>
                    </div>
                    <div className="revision-actions">
                      {state ? (
                        <>
                          <span className={`decision decision-${state}`}>
                            {state === "accepted" ? <Check size={16} /> : <X size={16} />}
                            {state === "accepted" ? "已采纳" : "已跳过"}
                          </span>
                          <button className="action-button" type="button" disabled={editorBusy} onClick={() => setRevisionState(revision.id)}>{state === "accepted" ? "取消采纳" : "重新考虑"}</button>
                        </>
                      ) : (
                        <>
                          <button className="action-button" type="button" disabled={editorBusy} onClick={() => setRevisionState(revision.id, "dismissed")}><X size={16} />跳过</button>
                          {revision.kind !== "reminder" ? <button className="action-button accept-button" type="button" disabled={editorBusy} onClick={() => setRevisionState(revision.id, "accepted")}><Check size={16} />采纳</button> : null}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="regenerate-bar">
              <div><strong>{acceptedRevisions.length} 条建议已采纳</strong><span>重新生成时只应用已采纳内容，原始事实会保留。</span></div>
              {generatingResume ? <div className="inline-work"><PhaseGlyph icon={(["scan", "write", "check"] as const)[generationPhase]} /><span>{["整理采纳内容", "重组简历表达", "准备可编辑预览"][generationPhase]}</span></div> : null}
              <button className="primary-button regenerate-button" type="button" disabled={!acceptedRevisions.length || editorBusy || analyzing || uploading || !analysisComplete} onClick={regenerateResume}>
                <span className="button-icon">{generatingResume ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}</span>
                <span>{generatingResume ? "正在重新生成" : "重新生成简历"}</span>
                <span className="button-icon" />
              </button>
            </div>
          </section>
        ) : null}

        {draft || generatingResume ? (
          <section className="resume-editor-section suggestions-enter" id="resume-editor">
            <div className="suggestions-heading">
              <div><span className="step-label">优化版简历</span><h2>检查、修改并下载</h2></div>
              <button className="action-button" type="button" disabled={!resumeHistory.length || editorBusy} onClick={undoResumeChange}><Undo2 size={16} />撤销上一步</button>
            </div>
            {draft ? <div className="draft-context">
              <p>当前草稿来源：{draft.resume.filename}</p>
              <details><summary>查看草稿对应岗位</summary><pre>{draft.jobDescription}</pre></details>
              {!draftMatchesInput ? <p role="status">这份草稿对应之前的简历或岗位，下载仍使用原草稿的内容和文件名。</p> : null}
              <label><input type="checkbox" checked={saveDraftLocally} onChange={(event) => setSaveDraftLocally(event.target.checked)} />在此设备自动保存草稿（含简历和岗位文本）</label>
              <small>默认不保存到本机。关闭后停止更新，已保存的副本可手动清除。</small>
              <button className="text-button" type="button" onClick={() => { try { localStorage.removeItem(DRAFT_STORAGE_KEY); setSaveDraftLocally(false); setSuccessMessage("已清除本机保存的草稿，编辑区内容仍保留。"); } catch { setError("本机草稿暂时无法清除，请检查浏览器存储设置。"); } }}>清除本机草稿</button>
            </div> : null}
            {pendingDraft ? <section className="draft-preview" aria-label={pendingDraft.operation === "refine" ? "AI 修改预览" : "新版本对照"}>
              <h3>{pendingDraft.complete === false ? "修改预览尚未完成，原稿保持不变" : "确认后才会替换当前草稿"}</h3>
              <p>新版本来源：{pendingDraft.resume.filename}。请核对新增或改变的经历、技能和数字，标记只用于提示改动，不能证明内容真实。</p>
              {pendingReview?.addedNumbers.length ? <p className="review-cue">新增数字，请核对：{pendingReview.addedNumbers.join("、")}</p> : null}
              {pendingReview?.addedTerms.length ? <p className="review-cue">新增技术或英文术语，请核对：{pendingReview.addedTerms.join("、")}</p> : null}
              <div className="comparison-grid">
                <div className="comparison original-copy"><span>当前草稿（删除或改写行已标记）</span><pre>{pendingReview?.originalLines.map((line, index) => <span className="review-line" key={index}>{line.changed ? <mark>{line.text || " "}</mark> : line.text || " "}{"\n"}</span>)}</pre></div>
                <div className="comparison revised-copy"><span>准备替换的新版本（新增或改写行已标记）</span><pre>{pendingReview?.lines.map((line, index) => <span className="review-line" key={index}>{line.changed ? <mark>{line.text || " "}</mark> : line.text || " "}{"\n"}</span>)}</pre></div>
              </div>
              <div className="draft-controls">
                <button className="action-button" type="button" disabled={editorBusy} onClick={() => { setPendingDraft(null); setSuccessMessage("已保留当前草稿。"); }}>保留当前草稿</button>
                <button className="action-button accept-button" type="button" disabled={editorBusy || pendingDraft.complete === false} onClick={() => applyDraft(pendingDraft)}>替换当前草稿</button>
              </div>
            </section> : null}
            <div className="editor-grid">
              <label className="resume-document">
                <span>可直接编辑正文</span>
                <textarea value={generatedResume} maxLength={60_000} disabled={editorBusy || Boolean(pendingDraft)} onChange={(event) => setDraft((current) => current ? { ...current, content: event.target.value } : current)} aria-label="优化版简历正文" />
              </label>
              <aside className="ai-refine-panel">
                <div><MessageSquare size={18} /><strong>继续让 AI 修改</strong></div>
                <p>点名某一段时只改该段；明确说“整体调整”时才会修改全文。草稿和修改要求会发送给模型服务，返回结果先供预览，确认后才替换原稿。</p>
                {refiningResume ? <div className="inline-work refine-work"><PhaseGlyph icon={(["scan", "write", "check"] as const)[refinePhase]} /><span>{["读取当前版本", "按要求修改段落", "检查事实一致性"][refinePhase]}</span></div> : null}
                <form onSubmit={refineGeneratedResume}>
                  <textarea value={aiInstruction} maxLength={2000} disabled={editorBusy} onChange={(event) => setAiInstruction(event.target.value)} placeholder="例如：把第二段写得更简洁，保留所有数据" aria-label="AI 修改要求" />
                  <button className="primary-button" type="submit" disabled={!generatedResume.trim() || !aiInstruction.trim() || editorBusy || Boolean(pendingDraft)}>
                    <span className="button-icon">{refiningResume ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}</span>
                    <span>{refiningResume ? "正在修改" : "应用 AI 修改"}</span>
                    <span className="button-icon" />
                  </button>
                  {refiningResume ? <button className="text-button" type="button" onClick={() => refineAbortRef.current?.abort()}>取消 AI 修改</button> : null}
                </form>
                <div className="download-actions">
                  <button className="action-button" type="button" disabled={Boolean(exporting) || editorBusy || !generatedResume.trim()} onClick={() => downloadResume("docx")}><Download size={16} />{exporting === "docx" ? "生成中" : "下载 DOCX"}</button>
                  <button className="action-button accept-button" type="button" disabled={Boolean(exporting) || editorBusy || !generatedResume.trim()} onClick={() => downloadResume("pdf")}><Download size={16} />{exporting === "pdf" ? "生成中" : "下载 PDF"}</button>
                </div>
              </aside>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

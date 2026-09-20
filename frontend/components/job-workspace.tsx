"use client";

import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleUserRound,
  FileText,
  Gauge,
  LoaderCircle,
  Menu,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { FormEvent, useState } from "react";

type Evidence = {
  skill: string;
  evidence: string;
};

type Gap = {
  skill: string;
  suggestion: string;
};

type MatchResult = {
  score: number;
  matched: Evidence[];
  gaps: Gap[];
  tailored_summary: string;
};

const initialResult: MatchResult = {
  score: 86,
  matched: [
    { skill: "Python", evidence: "负责 Python 服务开发与性能优化" },
    { skill: "FastAPI", evidence: "使用 FastAPI 重构订单服务 API" },
    { skill: "Redis", evidence: "引入 Redis 缓存，接口响应时间降低 42%" },
    { skill: "Docker", evidence: "通过 Docker 统一开发和部署环境" },
  ],
  gaps: [
    { skill: "Kubernetes", suggestion: "如有容器编排经验，请补充实际集群规模和职责" },
    { skill: "AWS", suggestion: "没有真实项目证据时，不建议写入简历" },
  ],
  tailored_summary:
    "3 年 Python 后端开发经验，熟悉 FastAPI、PostgreSQL 与 Redis，具备服务重构、性能优化和容器化交付经验。曾将核心接口响应时间降低 42%，能够独立推进后端服务从开发到上线。",
};

const sampleExperience = `3 年 Python 后端开发经验，负责电商订单与库存服务。

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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export function JobWorkspace() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [role, setRole] = useState("Python 后端工程师");
  const [years, setYears] = useState("3");
  const [experience, setExperience] = useState(sampleExperience);
  const [jobDescription, setJobDescription] = useState(sampleJob);
  const [result, setResult] = useState<MatchResult>(initialResult);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [resumeCreated, setResumeCreated] = useState(false);

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    setResumeCreated(false);

    try {
      const response = await fetch(`${API_URL}/api/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_role: role,
          years_experience: Number(years),
          experience,
          job_description: jobDescription,
        }),
      });

      if (!response.ok) {
        throw new Error("分析服务暂时不可用");
      }

      setResult((await response.json()) as MatchResult);
    } catch {
      setError("无法连接本地分析服务，请确认 FastAPI 已在 8000 端口启动。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            JT
          </div>
          <div>
            <strong>JobTailor</strong>
            <span>职业证据工作台</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="关闭导航"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={19} />
          </button>
        </div>

        <nav className="main-nav" aria-label="主导航">
          <a className="nav-item active" href="#workspace" onClick={() => setMobileNavOpen(false)}>
            <Gauge size={19} />
            定制工作台
          </a>
          <a className="nav-item" href="#profile" onClick={() => setMobileNavOpen(false)}>
            <CircleUserRound size={19} />
            职业档案
          </a>
          <a className="nav-item" href="#result" onClick={() => setMobileNavOpen(false)}>
            <FileText size={19} />
            简历版本
            <span className="nav-count">{resumeCreated ? 1 : 0}</span>
          </a>
        </nav>

        <div className="principle-note">
          <ShieldCheck size={18} />
          <div>
            <strong>真实经历优先</strong>
            <p>所有建议都应能回到你的项目证据。</p>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="avatar">陈</div>
          <div>
            <strong>陈默</strong>
            <span>后端工程师</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen ? (
        <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />
      ) : null}

      <main className="workspace" id="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label="打开导航"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div>
            <p className="eyebrow">岗位定制 / 新分析</p>
            <h1>把真实经历，对准这个岗位</h1>
          </div>
          <div className="privacy-state">
            <span className="status-dot" />
            本地规则分析
          </div>
        </header>

        <div className="workflow-grid">
          <form className="input-panel" id="profile" onSubmit={handleAnalyze}>
            <div className="panel-heading">
              <div>
                <span className="step-label">输入资料</span>
                <h2>职业档案与目标岗位</h2>
              </div>
              <span className="save-state">
                <FileText size={14} /> 当前草稿
              </span>
            </div>

            <div className="two-column-fields">
              <label className="field">
                <span>目标职位</span>
                <input value={role} onChange={(event) => setRole(event.target.value)} required />
              </label>
              <label className="field compact-field">
                <span>工作年限</span>
                <span className="input-suffix">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={years}
                    onChange={(event) => setYears(event.target.value)}
                    required
                  />
                  <span>年</span>
                </span>
              </label>
            </div>

            <label className="field text-field">
              <span className="field-title">
                <span>你的真实经历</span>
                <span>{experience.length} 字</span>
              </span>
              <textarea
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
                rows={10}
                minLength={40}
                required
              />
              <small>写清做了什么、使用什么方法，以及产生了什么结果。</small>
            </label>

            <div className="flow-connector" aria-hidden="true">
              <span />
              <ChevronRight size={16} />
              <span />
            </div>

            <label className="field text-field">
              <span className="field-title">
                <span>目标岗位 JD</span>
                <span>{jobDescription.length} 字</span>
              </span>
              <textarea
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                rows={9}
                minLength={30}
                required
              />
              <small>直接粘贴完整岗位描述，系统会识别技能要求和职责重点。</small>
            </label>

            {error ? <p className="error-message">{error}</p> : null}

            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading ? <LoaderCircle className="spin" size={18} /> : <ScanSearch size={18} />}
              {isLoading ? "正在分析" : "分析岗位匹配"}
              {isLoading ? null : <ArrowRight size={18} />}
            </button>
          </form>

          <section className="result-panel" id="result" aria-live="polite">
            <div className="result-header">
              <div>
                <span className="step-label">匹配结果</span>
                <h2>证据覆盖情况</h2>
              </div>
              <div className="score-block" aria-label={`岗位匹配度 ${result.score} 分`}>
                <strong>{result.score}</strong>
                <span>/ 100</span>
              </div>
            </div>

            <div className="score-track" aria-hidden="true">
              <span style={{ width: `${result.score}%` }} />
            </div>
            <p className="score-copy">
              你的核心后端经验覆盖了大部分要求。先补强证据较弱项，再生成正式简历版本。
            </p>

            <div className="result-section">
              <div className="section-title">
                <span className="section-icon success-icon"><Check size={16} /></span>
                <div>
                  <h3>有证据支撑</h3>
                  <p>{result.matched.length} 项要求能在经历中找到依据</p>
                </div>
              </div>
              <div className="evidence-list">
                {result.matched.map((item) => (
                  <div className="evidence-row" key={item.skill}>
                    <span className="skill-tag">{item.skill}</span>
                    <p>{item.evidence}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="result-section gap-section">
              <div className="section-title">
                <span className="section-icon gap-icon"><Target size={16} /></span>
                <div>
                  <h3>需要确认</h3>
                  <p>不要补写不存在的经历</p>
                </div>
              </div>
              <div className="gap-list">
                {result.gaps.map((item) => (
                  <div className="gap-row" key={item.skill}>
                    <strong>{item.skill}</strong>
                    <p>{item.suggestion}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="summary-section">
              <div className="section-title">
                <span className="section-icon summary-icon"><Sparkles size={16} /></span>
                <div>
                  <h3>岗位定制摘要</h3>
                  <p>仅使用已有经历生成</p>
                </div>
              </div>
              <blockquote>{result.tailored_summary}</blockquote>
              <button
                className="secondary-button"
                type="button"
                disabled={resumeCreated}
                onClick={() => setResumeCreated(true)}
              >
                {resumeCreated ? <Check size={17} /> : <BriefcaseBusiness size={17} />}
                {resumeCreated ? "简历版本已创建" : "创建简历版本"}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

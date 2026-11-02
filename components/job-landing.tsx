"use client";

import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, FileText, GitCompareArrows, ScanLine, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";

export function JobLanding() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointerQuery = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const paint = () => {
      frame = 0;
      const bounds = scene.getBoundingClientRect();
      const progress = motionQuery.matches ? 0 : Math.min(1, Math.max(0, (window.innerHeight * 0.55 - bounds.top) / window.innerHeight));
      scene.style.setProperty("--scene-progress", progress.toFixed(3));
      scene.style.setProperty("--pointer-x", `${motionQuery.matches ? 0 : pointerX}deg`);
      scene.style.setProperty("--pointer-y", `${motionQuery.matches ? 0 : pointerY}deg`);
    };
    const schedulePaint = () => {
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    const move = (event: PointerEvent) => {
      if (!pointerQuery.matches || motionQuery.matches) return;
      const bounds = scene.getBoundingClientRect();
      pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 5;
      pointerY = ((event.clientY - bounds.top) / bounds.height - 0.5) * -3;
      schedulePaint();
    };
    const reset = () => {
      pointerX = 0;
      pointerY = 0;
      schedulePaint();
    };

    window.addEventListener("scroll", schedulePaint, { passive: true });
    window.addEventListener("resize", schedulePaint, { passive: true });
    scene.addEventListener("pointermove", move, { passive: true });
    scene.addEventListener("pointerleave", reset);
    motionQuery.addEventListener("change", reset);
    schedulePaint();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedulePaint);
      window.removeEventListener("resize", schedulePaint);
      scene.removeEventListener("pointermove", move);
      scene.removeEventListener("pointerleave", reset);
      motionQuery.removeEventListener("change", reset);
    };
  }, []);

  return (
    <>
      <a className="skip-to-workspace" href="#workspace-main">跳转到简历工作台</a>
      <header className="site-nav">
        <a className="site-brand" href="#top" aria-label="JobTailor 首页">
          <span className="tailor-symbol" aria-hidden="true"><i /><i /><i /></span>
          <span>JobTailor<span className="brand-period">.</span></span>
        </a>
        <nav className="site-links" aria-label="主导航">
          <a href="#how-it-works">如何优化</a>
          <a href="#workspace">简历工作台</a>
        </nav>
        <a className="nav-cta" href="#workspace">开始优化 <ArrowUpRight size={16} /></a>
      </header>

      <section className="landing" id="top" aria-labelledby="landing-title">
        <div className="hero-atmosphere" aria-hidden="true"><span /><span /><span /></div>
        <div className="hero-copy">
          <p className="hero-caption"><span /> 每一份经历，都有它的分量</p>
          <h1 id="landing-title">你的经历，<br /><span>值得更好的表达。</span></h1>
          <p className="hero-description">从真实经历出发，对照目标岗位。<br className="mobile-break" />让简历里的每一句，都更有说服力。</p>
          <div className="hero-actions">
            <a className="hero-cta" href="#workspace">开始优化简历 <ArrowRight size={18} /></a>
            <a className="hero-secondary" href="#how-it-works">看看如何优化 <ArrowDown size={15} /></a>
          </div>
        </div>

        <div className="hero-scene" ref={sceneRef} aria-label="从原始简历、目标岗位到优化建议的流程示意">
          <div className="scene-floor" aria-hidden="true" />
          <div className="scene-panels" aria-hidden="true">
            <div className="scene-panel source-scene-panel">
              <div className="scene-window-bar"><span className="scene-window-dots"><i /><i /><i /></span><span><FileText size={13} /> 原始简历</span><span>PDF</span></div>
              <div className="scene-resume">
                <div className="scene-person"><span className="scene-avatar">陈</span><div><strong>陈默</strong><span>Python 后端工程师 · 3 年经验</span></div></div>
                <div className="scene-rule" />
                <p className="scene-section-label">项目经历</p>
                <h3>电商订单系统</h3>
                <p>负责订单接口的开发和维护，<br />参与数据库优化和服务部署。</p>
                <div className="scene-text-lines"><i /><i /><i /></div>
                <div className="source-highlight"><ScanLine size={16} /><span>从已有经历中，找到关键证据</span></div>
              </div>
            </div>

            <div className="scene-panel job-scene-panel">
              <div className="scene-window-bar"><span className="scene-window-dots"><i /><i /><i /></span><span>目标岗位</span><ArrowUpRight size={14} /></div>
              <div className="scene-job">
                <span className="scene-job-label">寻找下一步</span>
                <h3>Python<br />后端工程师</h3>
                <p>把你的经验，放进岗位的语境。</p>
                <div className="scene-skills"><span>Python</span><span>FastAPI</span><span>Redis</span><span>PostgreSQL</span></div>
                <div className="scene-job-requirement"><Check size={14} /><span>核心业务服务开发</span></div>
                <div className="scene-job-requirement"><Check size={14} /><span>数据库与接口性能优化</span></div>
                <div className="scene-job-requirement"><Check size={14} /><span>团队协作与版本交付</span></div>
              </div>
            </div>

            <div className="scene-panel match-scene-panel">
              <div className="scene-window-bar"><span className="scene-panel-brand"><span className="tailor-symbol" aria-hidden="true"><i /><i /><i /></span>JobTailor</span><span className="scene-live-status"><i /> 经历有据，表达有力</span></div>
              <div className="scene-match-body">
                <div className="scene-match-heading"><span className="scene-match-icon"><GitCompareArrows size={21} /></span><div><span>让成果被看见</span><h3>同一段经历，更清楚的表达。</h3></div></div>
                <div className="scene-before"><span>原始表达</span><p>负责接口优化，提升系统性能。</p></div>
                <div className="scene-after"><span><CheckCheck size={14} /> 结合已有事实</span><p>引入 Redis 缓存热点商品数据，<br />接口响应时间<strong>降低 42%</strong>。</p></div>
                <div className="scene-match-footer"><span><ShieldCheck size={14} /> 不添加未经确认的经历</span><span className="scene-accepted"><Check size={13} /> 由你决定采纳</span></div>
              </div>
            </div>
          </div>
          <p className="scene-caption">工作流程示意 · 使用示例数据</p>
        </div>

        <div className="hero-principles"><span><ShieldCheck size={15} /> 真实经历，不凭空编造</span><span><GitCompareArrows size={15} /> 逐条对照，由你采纳</span><span><FileText size={15} /> 支持 PDF / Word 导出</span></div>
      </section>

      <section className="how-it-works" id="how-it-works" aria-labelledby="process-title">
        <div className="process-intro"><p>更好的简历，从读懂经历开始。</p><h2 id="process-title">不止是改写。<br /><span>让每一步都有依据。</span></h2><a href="#workspace">现在开始 <ArrowUpRight size={17} /></a></div>
        <ol className="process-list">
          <li><span className="process-number">01</span><div><h3>放入简历，选定方向</h3><p>上传 PDF 或 Word 简历，粘贴你想申请的岗位描述。</p></div><FileText size={20} /></li>
          <li><span className="process-number">02</span><div><h3>看清匹配，逐条打磨</h3><p>对照岗位要求，找到已有证据与待补充内容，再决定采纳哪些建议。</p></div><GitCompareArrows size={20} /></li>
          <li><span className="process-number">03</span><div><h3>保留你的声音，准备出发</h3><p>生成后仍可编辑，核对每一处改动，再导出属于你的简历。</p></div><ArrowUpRight size={20} /></li>
        </ol>
      </section>
    </>
  );
}

import { JobWorkspace } from "@/components/job-workspace";
import { JobLanding } from "@/components/job-landing";
import { ArrowUpRight } from "lucide-react";

export default function Home() {
  return (
    <>
      <JobLanding />
      <JobWorkspace />
      <footer className="site-footer"><span>JobTailor · 让真实经历，被更好地看见。</span><a href="#top">回到顶部 <ArrowUpRight size={14} /></a></footer>
    </>
  );
}

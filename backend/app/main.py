import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


SKILLS = (
    "Python",
    "FastAPI",
    "Django",
    "PostgreSQL",
    "MySQL",
    "Redis",
    "Docker",
    "Kubernetes",
    "AWS",
    "React",
    "TypeScript",
    "微服务",
    "高并发",
    "团队协作",
)


class MatchRequest(BaseModel):
    target_role: str = Field(min_length=2, max_length=80)
    years_experience: float = Field(ge=0, le=50)
    experience: str = Field(min_length=40, max_length=20_000)
    job_description: str = Field(min_length=30, max_length=20_000)


class Evidence(BaseModel):
    skill: str
    evidence: str


class Gap(BaseModel):
    skill: str
    suggestion: str


class MatchResponse(BaseModel):
    score: int
    matched: list[Evidence]
    gaps: list[Gap]
    tailored_summary: str


def contains_skill(text: str, skill: str) -> bool:
    return skill.casefold() in text.casefold()


def evidence_for(experience: str, skill: str) -> str:
    fragments = [part.strip(" •\t") for part in re.split(r"[\n。；]", experience) if part.strip()]
    return next((part for part in fragments if contains_skill(part, skill)), "经历中已提及该项能力")


def analyze_match(payload: MatchRequest) -> MatchResponse:
    requirements = [skill for skill in SKILLS if contains_skill(payload.job_description, skill)]
    matched_skills = [skill for skill in requirements if contains_skill(payload.experience, skill)]
    gap_skills = [skill for skill in requirements if skill not in matched_skills]

    coverage = len(matched_skills) / max(len(requirements), 1)
    evidence_bonus = 10 if any(char.isdigit() for char in payload.experience) else 4
    experience_bonus = min(round(payload.years_experience * 2), 10)
    score = min(round(coverage * 80 + evidence_bonus + experience_bonus), 98)

    matched = [
        Evidence(skill=skill, evidence=evidence_for(payload.experience, skill))
        for skill in matched_skills[:6]
    ]
    gaps = [
        Gap(
            skill=skill,
            suggestion=f"如有 {skill} 的真实使用经历，请补充场景、职责和结果；否则不要写入简历。",
        )
        for skill in gap_skills[:3]
    ]

    top_skills = "、".join(matched_skills[:4]) or "后端开发"
    summary = (
        f"{payload.years_experience:g} 年相关经验，目标岗位为{payload.target_role}。"
        f"已有经历能够证明 {top_skills} 等能力，并包含可量化的项目结果。"
        "建议围绕最匹配的项目说明职责、技术选择与业务影响。"
    )

    return MatchResponse(score=score, matched=matched, gaps=gaps, tailored_summary=summary)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="JobTailor API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/match", response_model=MatchResponse)
def match_job(payload: MatchRequest) -> MatchResponse:
    return analyze_match(payload)

from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_match_returns_evidence_and_gaps() -> None:
    response = client.post(
        "/api/match",
        json={
            "target_role": "Python 后端工程师",
            "years_experience": 3,
            "experience": "使用 Python 和 FastAPI 开发订单服务，引入 Redis 后响应时间降低 42%。",
            "job_description": "要求熟悉 Python、FastAPI、Redis、Docker 和 Kubernetes，负责后端服务开发。",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["score"] > 50
    assert {item["skill"] for item in body["matched"]} == {"Python", "FastAPI", "Redis"}
    assert {item["skill"] for item in body["gaps"]} == {"Docker", "Kubernetes"}
    assert "Python 后端工程师" in body["tailored_summary"]

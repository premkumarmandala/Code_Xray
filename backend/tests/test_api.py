from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "CodeXRay Backend API"}


def test_compile_endpoint_schema():
    payload = {
        "code": "#include <stdio.h>\nint main() { printf(\"Hello CodeXRay\\n\"); return 0; }",
        "filename": "sum.c",
        "timeout": 2.0
    }
    response = client.post("/api/compile", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert data["filename"] == "sum.c"
    assert data["base_name"] == "sum"
    assert "stages" in data
    assert "errors" in data

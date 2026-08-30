from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check():
    for endpoint in ["/", "/health", "/api/health"]:
        response = client.get(endpoint)
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


def test_debug_callstack_endpoint():
    payload = {
        "code": "#include <stdio.h>\nint add(int a, int b) { int r = a + b; return r; }\nint main() { int x = 10; int y = 20; return add(x, y); }",
        "filename": "main.c",
        "timeout": 2.0
    }
    response = client.post("/api/debug/callstack", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["frames"]) >= 2
    f0 = data["frames"][0]
    assert f0["frame_number"] == 0
    assert f0["function"] == "add"
    assert "variables" in f0
    assert f0["variables"][0]["size_bytes"] == 4

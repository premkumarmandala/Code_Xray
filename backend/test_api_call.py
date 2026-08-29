import json
import urllib.request

payload = {
    "code": "#include <stdio.h>\nint main() { printf(\"Hello from Live API\\n\"); return 0; }",
    "filename": "main.c",
    "timeout": 5.0
}

req = urllib.request.Request(
    "http://127.0.0.1:8000/api/compile",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("Success:", data.get("success"))
        print("Overall Output:", repr(data.get("output")))
        print("Execution Stage Data:")
        print(json.dumps(data.get("stages", {}).get("execution"), indent=2))
except Exception as err:
    print("Error calling API:", err)

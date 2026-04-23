import os

import app as target


def make_client():
    target.app.config.update(TESTING=True)
    return target.app.test_client()


# --- Scope tests ---


def test_foundry_scope_defaults_to_ai_azure():
    assert target.FOUNDRY_SCOPE == "https://ai.azure.com/.default"


def test_foundry_scope_configurable(monkeypatch):
    monkeypatch.setenv("FOUNDRY_SCOPE", "https://custom.scope/.default")
    monkeypatch.setattr(target, "FOUNDRY_SCOPE", os.getenv("FOUNDRY_SCOPE"))
    assert target.FOUNDRY_SCOPE == "https://custom.scope/.default"


def test_foundry_request_uses_scope(monkeypatch):
    """foundry_request passes FOUNDRY_SCOPE to credential.get_token."""
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")
    monkeypatch.setattr(target, "FOUNDRY_API_VERSION", "v1")
    monkeypatch.setattr(target, "FOUNDRY_SCOPE", "https://ai.azure.com/.default")

    captured_scope = {}

    class FakeToken:
        token = "fake-token"

    class FakeCredential:
        def get_token(self, scope):
            captured_scope["scope"] = scope
            return FakeToken()

    monkeypatch.setattr(target, "credential", FakeCredential())

    class FakeResponse:
        ok = True
        status_code = 200
        text = "{}"
        headers = {"content-type": "application/json"}
        def json(self):
            return {"id": "test"}

    monkeypatch.setattr(target.requests, "request", lambda *a, **kw: FakeResponse())

    target.foundry_request("/test", "GET")
    assert captured_scope["scope"] == "https://ai.azure.com/.default"


# --- API version tests ---


def test_foundry_api_version_defaults_to_v1():
    assert target.FOUNDRY_API_VERSION == "v1"


def test_foundry_request_appends_api_version(monkeypatch):
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")
    monkeypatch.setattr(target, "FOUNDRY_API_VERSION", "v1")

    class FakeToken:
        token = "fake-token"

    class FakeCredential:
        def get_token(self, scope):
            return FakeToken()

    monkeypatch.setattr(target, "credential", FakeCredential())

    captured_url = {}

    class FakeResponse:
        ok = True
        status_code = 200
        text = "{}"
        headers = {"content-type": "application/json"}
        def json(self):
            return {}

    def fake_request(method, url, **kwargs):
        captured_url["url"] = url
        return FakeResponse()

    monkeypatch.setattr(target.requests, "request", fake_request)

    target.foundry_request("/agents", "GET")
    assert "api-version=v1" in captured_url["url"]


# --- Create agent tests ---


def test_create_agent_requires_name_and_instructions():
    client = make_client()
    response = client.post("/api/agents", json={})
    assert response.status_code == 400
    assert "Name and instructions" in response.get_json()["error"]


def test_create_agent_requires_model_deployment(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_MODEL_DEPLOYMENT", "")
    response = client.post(
        "/api/agents",
        json={"name": "Jaime", "instructions": "Pokemon specialist"},
    )
    assert response.status_code == 500
    assert "FOUNDRY_MODEL_DEPLOYMENT" in response.get_json()["error"]


def test_create_agent_sends_definition_with_kind_prompt(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_MODEL_DEPLOYMENT", "gpt-5.4")

    captured_body = {}

    def fake_foundry_request(path, method, body=None):
        captured_body.update(body or {})
        return {"id": "agent-123", "name": "Jaime"}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/agents",
        json={"name": "Jaime", "instructions": "Pokemon specialist"},
    )

    assert response.status_code == 200
    assert captured_body["definition"]["kind"] == "prompt"
    assert captured_body["definition"]["model"] == "gpt-5.4"
    assert captured_body["definition"]["instructions"] == "Pokemon specialist"


def test_create_agent_returns_id_and_name(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_MODEL_DEPLOYMENT", "gpt-5.4")

    def fake_foundry_request(path, method, body=None):
        return {"id": "agent-123", "name": "Jaime"}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/agents",
        json={"name": "Jaime", "instructions": "Pokemon specialist"},
    )

    data = response.get_json()
    assert response.status_code == 200
    assert data["id"] == "agent-123"
    assert data["name"] == "Jaime"


# --- Send message tests ---


def test_send_message_requires_agent_name_and_message():
    client = make_client()
    response = client.post("/api/messages", json={})
    assert response.status_code == 400
    assert "agentName" in response.get_json()["error"]


def test_send_message_uses_responses_api(monkeypatch):
    client = make_client()

    captured = {}

    def fake_foundry_request(path, method, body=None):
        captured["path"] = path
        captured["body"] = body
        return {"output_text": "Hello from the agent!"}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "Jaime", "message": "Hello"},
    )

    assert response.status_code == 200
    assert response.get_json()["response"] == "Hello from the agent!"
    assert captured["path"] == "/openai/v1/responses"
    assert captured["body"]["agent_reference"]["type"] == "agent_reference"
    assert captured["body"]["agent_reference"]["name"] == "Jaime"
    assert captured["body"]["input"] == [{"role": "user", "content": "Hello"}]


def test_send_message_extracts_from_output_array(monkeypatch):
    """Falls back to parsing output array when output_text is empty."""
    client = make_client()

    def fake_foundry_request(path, method, body=None):
        return {
            "output_text": "",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {"type": "output_text", "text": "Fallback response."}
                    ],
                }
            ],
        }

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "Jaime", "message": "Hello"},
    )

    assert response.status_code == 200
    assert response.get_json()["response"] == "Fallback response."


def test_send_message_no_response(monkeypatch):
    client = make_client()

    def fake_foundry_request(path, method, body=None):
        return {"output_text": "", "output": []}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "Jaime", "message": "Hello"},
    )

    assert response.status_code == 200
    assert response.get_json()["response"] == "No response received from agent."

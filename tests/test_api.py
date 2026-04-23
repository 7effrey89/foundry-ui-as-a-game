import os

import app as target


def make_client():
    target.app.config.update(TESTING=True)
    return target.app.test_client()


# --- Scope tests ---


def test_foundry_scope_defaults_to_ai_azure():
    assert target.FOUNDRY_SCOPE == "https://ai.azure.com"


def test_foundry_scope_configurable(monkeypatch):
    monkeypatch.setenv("FOUNDRY_SCOPE", "https://custom.scope/.default")
    monkeypatch.setattr(target, "FOUNDRY_SCOPE", os.getenv("FOUNDRY_SCOPE"))
    assert target.FOUNDRY_SCOPE == "https://custom.scope/.default"


def test_foundry_request_uses_scope(monkeypatch):
    """foundry_request passes FOUNDRY_SCOPE to credential.get_token."""
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")
    monkeypatch.setattr(target, "FOUNDRY_API_VERSION", "v1")
    monkeypatch.setattr(target, "FOUNDRY_SCOPE", "https://ai.azure.com")

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
    assert captured_scope["scope"] == "https://ai.azure.com"


# --- Helper extraction tests ---


def test_extract_response_text_uses_output_text():
    result = {"output_text": "Primary text", "output": []}
    assert target._extract_response_text(result) == "Primary text"


def test_extract_response_text_falls_back_to_message_output():
    result = {
        "output_text": "",
        "output": [
            {
                "type": "message",
                "content": [
                    {"type": "output_text", "text": "Fallback text"},
                ],
            }
        ],
    }
    assert target._extract_response_text(result) == "Fallback text"


def test_extract_response_text_returns_empty_when_no_text():
    assert target._extract_response_text({"output_text": "", "output": []}) == ""


def test_build_trace_entries_extracts_supported_types():
    result = {
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": "hello"}],
            },
            {
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": "thinking"}],
            },
            {
                "type": "mcp_approval_request",
                "id": "approval-1",
                "server_label": "kb_demo",
                "name": "retrieve",
            },
            {
                "type": "mcp_call",
                "id": "call-1",
            },
        ]
    }

    trace = target._build_trace_entries(result)
    assert any(item["type"] == "message_output" for item in trace)
    assert any(item["type"] == "reasoning" for item in trace)
    assert any(item["type"] == "tool_approval_request" for item in trace)
    assert any(item["type"] == "mcp_call" for item in trace)


def test_build_trace_entries_handles_empty_or_malformed_items():
    empty_trace = target._build_trace_entries({"output": []})
    malformed_trace = target._build_trace_entries({"output": [{}]})
    message_without_text = target._build_trace_entries(
        {"output": [{"type": "message", "content": [{}]}]}
    )
    assert empty_trace == []
    assert malformed_trace == []
    assert message_without_text == []


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


def test_foundry_request_skips_api_version_for_v1_path(monkeypatch):
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

    target.foundry_request("/openai/v1/responses", "POST")
    assert "api-version" not in captured_url["url"]


# --- Create agent tests ---


def test_list_agents_returns_array(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")

    def fake_foundry_request(path, method, body=None):
        return {
            "data": [
                {"id": "a1", "name": "Agent One", "versions": {"latest": {"definition": {}}}},
                {"id": "a2", "name": "Agent Two", "versions": {"latest": {"definition": {}}}},
            ]
        }

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.get("/api/agents")
    data = response.get_json()
    assert response.status_code == 200
    assert len(data) == 2
    assert data[0]["id"] == "a1"
    assert data[1]["name"] == "Agent Two"
    assert data[0]["tools"] == []
    assert data[0]["knowledge"] == []
    assert data[0]["memory"] == []
    assert data[0]["guardrail"] == ""


def test_list_agents_returns_three(monkeypatch):
    """Listing agents returns at least 3 entries from the Foundry data key."""
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")

    def fake_foundry_request(path, method, body=None):
        return {
            "data": [
                {"id": "a1", "name": "Agent One", "versions": {"latest": {"definition": {}}}},
                {"id": "a2", "name": "Agent Two", "versions": {"latest": {"definition": {}}}},
                {"id": "a3", "name": "Agent Three", "versions": {"latest": {"definition": {}}}},
            ]
        }

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.get("/api/agents")
    data = response.get_json()
    assert response.status_code == 200
    assert len(data) >= 3
    assert data[0]["id"] == "a1"
    assert data[1]["id"] == "a2"
    assert data[2]["id"] == "a3"


def test_list_agents_extracts_tools_knowledge_memory_guardrail(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")

    def fake_foundry_request(path, method, body=None):
        return {
            "data": [
                {
                    "id": "rich",
                    "name": "RichAgent",
                    "versions": {
                        "latest": {
                            "definition": {
                                "tools": [
                                    {"type": "web_search"},
                                    {"type": "code_interpreter", "container": {"type": "auto"}},
                                    {"type": "mcp", "server_label": "my_kb"},
                                    {"type": "memory_search_preview", "memory_store_name": "store1"},
                                ],
                                "rai_config": {
                                    "rai_policy_name": "/subs/123/raiPolicies/MyGuardrail"
                                },
                            }
                        }
                    },
                }
            ]
        }

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.get("/api/agents")
    data = response.get_json()
    assert response.status_code == 200
    agent = data[0]
    assert agent["tools"] == ["web_search", "code_interpreter"]
    assert agent["knowledge"] == ["my_kb"]
    assert agent["memory"] == ["store1"]
    assert agent["guardrail"] == "MyGuardrail"


def test_list_agents_empty(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")

    def fake_foundry_request(path, method, body=None):
        return {"data": []}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.get("/api/agents")
    assert response.status_code == 200
    assert response.get_json() == []


def test_list_agents_handles_non_dict(monkeypatch):
    client = make_client()

    def fake_foundry_request(path, method, body=None):
        return None

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")

    response = client.get("/api/agents")
    assert response.status_code == 200
    assert response.get_json() == []


def test_list_agents_missing_endpoint(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "")

    response = client.get("/api/agents")
    assert response.status_code == 500
    assert "FOUNDRY_PROJECT_ENDPOINT" in response.get_json()["error"]


def test_list_agents_foundry_error(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "FOUNDRY_PROJECT_ENDPOINT", "https://example.com")

    def fake_foundry_request(path, method, body=None):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.get("/api/agents")
    assert response.status_code == 502
    assert "Failed to list agents" in response.get_json()["error"]


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
    assert response.get_json()["trace"][0]["type"] == "input"
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


def test_send_message_trace_contains_message_output_and_final_response(monkeypatch):
    client = make_client()

    def fake_foundry_request(path, method, body=None):
        return {
            "output_text": "",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "Trace hello"}],
                }
            ],
        }

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "Jaime", "message": "Hello"},
    )

    assert response.status_code == 200
    trace = response.get_json()["trace"]
    assert any(item["type"] == "message_output" for item in trace)
    assert any(item["type"] == "final_response" for item in trace)


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


def test_send_message_auto_approves_mcp_tools(monkeypatch):
    """When the agent requests MCP tool approval, the backend auto-approves."""
    client = make_client()
    call_count = {"n": 0}
    captured_calls = []

    def fake_foundry_request(path, method, body=None):
        captured_calls.append(body)
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {
                "id": "resp_1",
                "model": "gpt-4.1",
                "output_text": "",
                "output": [
                    {"type": "mcp_list_tools", "id": "mcpl_1"},
                    {"type": "mcp_approval_request", "id": "mcpr_1",
                     "server_label": "kb_demo", "name": "knowledge_base_retrieve"},
                ],
            }
        return {"id": "resp_2", "output_text": "Here is the answer from the KB."}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "k", "message": "tell me about cph"},
    )

    assert response.status_code == 200
    assert response.get_json()["response"] == "Here is the answer from the KB."
    trace = response.get_json()["trace"]
    assert any(item["type"] == "tool_approval_request" for item in trace)
    assert any(item["type"] == "tool_approval_response" for item in trace)
    assert call_count["n"] == 2
    approval_body = captured_calls[1]
    assert approval_body["previous_response_id"] == "resp_1"
    assert approval_body["model"] == "gpt-4.1"
    assert approval_body["agent_reference"]["name"] == "k"
    assert approval_body["input"][0]["type"] == "mcp_approval_response"
    assert approval_body["input"][0]["approve"] is True
    assert approval_body["input"][0]["approval_request_id"] == "mcpr_1"


def test_send_message_returns_reasoning_trace(monkeypatch):
    client = make_client()

    def fake_foundry_request(path, method, body=None):
        return {
            "id": "resp_1",
            "output_text": "Done.",
            "output": [
                {
                    "type": "reasoning",
                    "summary": [{"type": "summary_text", "text": "Used policy and tool routing."}],
                }
            ],
        }

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "r", "message": "go"},
    )

    assert response.status_code == 200
    trace = response.get_json()["trace"]
    assert any(item["type"] == "reasoning" for item in trace)


# --- Assets route tests ---


def test_serve_assets_returns_file():
    client = make_client()
    response = client.get("/assets/img/2026-04-23%20125726-gpt-image-1_5.png")
    assert response.status_code == 200
    assert response.content_type.startswith("image/")

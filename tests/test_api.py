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

    monkeypatch.setattr(target, "FOUNDRY_API_VERSION", "v1")

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


# --- Context parameter tests ---


def test_send_message_with_context(monkeypatch):
    """Context messages are prepended to the input array."""
    client = make_client()
    captured = {}

    def fake_foundry_request(path, method, body=None):
        captured["body"] = body
        return {"output_text": "Response with context."}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={
            "agentName": "Jaime",
            "message": "Hello",
            "context": [
                {"role": "user", "content": "Prior question"},
                {"role": "assistant", "content": "Prior answer"},
            ],
        },
    )

    assert response.status_code == 200
    input_msgs = captured["body"]["input"]
    assert len(input_msgs) == 3
    assert input_msgs[0] == {"role": "user", "content": "Prior question"}
    assert input_msgs[1] == {"role": "assistant", "content": "Prior answer"}
    assert input_msgs[2] == {"role": "user", "content": "Hello"}


def test_send_message_context_filters_invalid_roles(monkeypatch):
    """Only user, assistant, and system roles are allowed in context."""
    client = make_client()
    captured = {}

    def fake_foundry_request(path, method, body=None):
        captured["body"] = body
        return {"output_text": "Filtered."}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={
            "agentName": "Jaime",
            "message": "Hello",
            "context": [
                {"role": "admin", "content": "Evil injection"},
                {"role": "user", "content": "Valid"},
                {"role": "", "content": "Empty role"},
                {"role": "assistant", "content": ""},
                "not-a-dict",
            ],
        },
    )

    assert response.status_code == 200
    input_msgs = captured["body"]["input"]
    assert len(input_msgs) == 2
    assert input_msgs[0] == {"role": "user", "content": "Valid"}
    assert input_msgs[1] == {"role": "user", "content": "Hello"}


def test_send_message_without_context(monkeypatch):
    """When no context is provided, input contains only the user message."""
    client = make_client()
    captured = {}

    def fake_foundry_request(path, method, body=None):
        captured["body"] = body
        return {"output_text": "No context."}

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "Jaime", "message": "Hello"},
    )

    assert response.status_code == 200
    input_msgs = captured["body"]["input"]
    assert len(input_msgs) == 1
    assert input_msgs[0] == {"role": "user", "content": "Hello"}


# --- Metrics tests ---


def test_record_metrics_accumulates_usage():
    target._agent_metrics.clear()
    result = {
        "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
        "output": [],
    }
    target._record_metrics("AgentA", result)
    m = target._agent_metrics["AgentA"]
    assert m["runs"] == 1
    assert m["prompt_tokens"] == 100
    assert m["completion_tokens"] == 50
    assert m["total_tokens"] == 150
    assert m["errors"] == 0
    assert m["tool_calls"] == 0

    # second call accumulates
    target._record_metrics("AgentA", result)
    assert m["runs"] == 2
    assert m["prompt_tokens"] == 200
    assert m["total_tokens"] == 300


def test_record_metrics_counts_tool_calls():
    target._agent_metrics.clear()
    result = {
        "usage": {"total_tokens": 10},
        "output": [
            {"type": "mcp_list_tools"},
            {"type": "mcp_call"},
            {"type": "message", "content": []},
        ],
    }
    target._record_metrics("AgentB", result)
    assert target._agent_metrics["AgentB"]["tool_calls"] == 2


def test_record_metrics_tracks_errors():
    target._agent_metrics.clear()
    target._record_metrics("AgentC", {}, error=True)
    m = target._agent_metrics["AgentC"]
    assert m["runs"] == 1
    assert m["errors"] == 1
    assert m["total_tokens"] == 0


def test_get_metrics_endpoint(monkeypatch):
    client = make_client()
    target._agent_metrics.clear()
    target._agent_metrics["Jaime"] = {
        "runs": 3,
        "errors": 0,
        "prompt_tokens": 200,
        "completion_tokens": 100,
        "total_tokens": 300,
        "tool_calls": 1,
    }
    response = client.get("/api/metrics")
    assert response.status_code == 200
    data = response.get_json()
    assert data["Jaime"]["runs"] == 3
    assert data["Jaime"]["total_tokens"] == 300
    target._agent_metrics.clear()


def test_send_message_returns_usage_in_response(monkeypatch):
    client = make_client()
    target._agent_metrics.clear()

    def fake_foundry_request(path, method, body=None):
        return {
            "output_text": "Hello!",
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
            "output": [],
        }

    monkeypatch.setattr(target, "foundry_request", fake_foundry_request)

    response = client.post(
        "/api/messages",
        json={"agentName": "Jaime", "message": "Hi"},
    )

    assert response.status_code == 200
    data = response.get_json()
    assert "usage" in data
    assert data["usage"]["runs"] == 1
    assert data["usage"]["total_tokens"] == 15
    target._agent_metrics.clear()


def test_metrics_empty_when_no_runs():
    client = make_client()
    target._agent_metrics.clear()
    response = client.get("/api/metrics")
    assert response.status_code == 200
    assert response.get_json() == {}


def test_record_metrics_handles_legacy_token_keys():
    """Supports both OpenAI-style (prompt_tokens) and Foundry-style (input_tokens) keys."""
    target._agent_metrics.clear()
    result = {
        "usage": {"prompt_tokens": 80, "completion_tokens": 40, "total_tokens": 120},
        "output": [],
    }
    target._record_metrics("AgentD", result)
    m = target._agent_metrics["AgentD"]
    assert m["prompt_tokens"] == 80
    assert m["completion_tokens"] == 40
    assert m["total_tokens"] == 120


# --- TTS tests ---


def test_tts_status_unavailable_when_no_endpoint(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_TTS_ENDPOINT", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_RESOURCE_ID", "")

    response = client.get("/api/tts/status")
    data = response.get_json()
    assert response.status_code == 200
    assert data["available"] is False
    assert isinstance(data["voices"], list)


def test_tts_status_available_with_key(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "test-key")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "eastus")

    response = client.get("/api/tts/status")
    data = response.get_json()
    assert response.status_code == 200
    assert data["available"] is True
    assert len(data["voices"]) == 6


def test_tts_status_available_with_region_only(monkeypatch):
    """TTS is available when region is set, even without key or resource ID."""
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "eastus")
    monkeypatch.setattr(target, "AZURE_SPEECH_RESOURCE_ID", "")

    response = client.get("/api/tts/status")
    data = response.get_json()
    assert response.status_code == 200
    assert data["available"] is True


def test_tts_requires_text():
    client = make_client()
    response = client.post("/api/tts", json={"voice": "en-us-Jasper:MAI-Voice-1"})
    assert response.status_code == 400
    assert "text" in response.get_json()["error"]


def test_tts_requires_voice():
    client = make_client()
    response = client.post("/api/tts", json={"text": "Hello"})
    assert response.status_code == 400
    assert "voice" in response.get_json()["error"]


def test_tts_rejects_unknown_voice():
    client = make_client()
    response = client.post("/api/tts", json={"text": "Hello", "voice": "unknown-voice"})
    assert response.status_code == 400
    assert "Unknown voice" in response.get_json()["error"]


def test_tts_returns_audio(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "test-key")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "eastus")
    monkeypatch.setattr(target, "AZURE_SPEECH_TTS_ENDPOINT", "")

    class FakeTtsResponse:
        ok = True
        status_code = 200
        content = b"fake-audio-bytes"
        text = ""

    captured = {}

    def fake_post(url, headers=None, data=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["data"] = data
        return FakeTtsResponse()

    monkeypatch.setattr(target.requests, "post", fake_post)

    response = client.post(
        "/api/tts",
        json={"text": "Hello world", "voice": "en-us-Jasper:MAI-Voice-1"},
    )

    assert response.status_code == 200
    assert response.content_type == "audio/mpeg"
    assert response.data == b"fake-audio-bytes"
    assert "eastus.tts.speech.microsoft.com" in captured["url"]
    assert captured["headers"]["Ocp-Apim-Subscription-Key"] == "test-key"
    assert b"en-us-Jasper:MAI-Voice-1" in captured["data"]


def test_tts_escapes_xml_special_chars(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "test-key")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "eastus")

    captured = {}

    class FakeTtsResponse:
        ok = True
        status_code = 200
        content = b"audio"
        text = ""

    def fake_post(url, headers=None, data=None, timeout=None):
        captured["data"] = data
        return FakeTtsResponse()

    monkeypatch.setattr(target.requests, "post", fake_post)

    response = client.post(
        "/api/tts",
        json={"text": "A < B & C > D", "voice": "en-us-June:MAI-Voice-1"},
    )

    assert response.status_code == 200
    ssml = captured["data"].decode("utf-8")
    assert "&lt;" in ssml
    assert "&amp;" in ssml
    assert "&gt;" in ssml
    assert "< B" not in ssml


def test_tts_endpoint_not_configured(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "test-key")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_TTS_ENDPOINT", "")

    response = client.post(
        "/api/tts",
        json={"text": "Hello", "voice": "en-us-Jasper:MAI-Voice-1"},
    )

    assert response.status_code == 500
    assert "not configured" in response.get_json()["error"]


def test_tts_custom_endpoint(monkeypatch):
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "test-key")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "")
    monkeypatch.setattr(
        target,
        "AZURE_SPEECH_TTS_ENDPOINT",
        "https://custom.tts.endpoint/cognitiveservices/v1",
    )

    captured = {}

    class FakeTtsResponse:
        ok = True
        status_code = 200
        content = b"audio"
        text = ""

    def fake_post(url, headers=None, data=None, timeout=None):
        captured["url"] = url
        return FakeTtsResponse()

    monkeypatch.setattr(target.requests, "post", fake_post)

    response = client.post(
        "/api/tts",
        json={"text": "Hello", "voice": "en-us-Grant:MAI-Voice-1"},
    )

    assert response.status_code == 200
    assert captured["url"] == "https://custom.tts.endpoint/cognitiveservices/v1"


def test_tts_default_credential_no_resource_id(monkeypatch):
    """When no key and no resource ID, uses plain Bearer token from DefaultAzureCredential."""
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "eastus")
    monkeypatch.setattr(target, "AZURE_SPEECH_TTS_ENDPOINT", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_RESOURCE_ID", "")

    class FakeToken:
        token = "fake-aad-token"

    monkeypatch.setattr(target.credential, "get_token", lambda scope: FakeToken())

    class FakeTtsResponse:
        ok = True
        status_code = 200
        content = b"audio-bytes"
        text = ""

    captured = {}

    def fake_post(url, headers=None, data=None, timeout=None):
        captured["headers"] = headers
        return FakeTtsResponse()

    monkeypatch.setattr(target.requests, "post", fake_post)

    response = client.post(
        "/api/tts",
        json={"text": "Hello", "voice": "en-us-Jasper:MAI-Voice-1"},
    )

    assert response.status_code == 200
    assert captured["headers"]["Authorization"] == "Bearer fake-aad-token"
    assert "Ocp-Apim-Subscription-Key" not in captured["headers"]


def test_tts_default_credential_with_resource_id(monkeypatch):
    """When no key but resource ID is set, uses aad# token format."""
    client = make_client()
    monkeypatch.setattr(target, "AZURE_SPEECH_KEY", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_REGION", "eastus")
    monkeypatch.setattr(target, "AZURE_SPEECH_TTS_ENDPOINT", "")
    monkeypatch.setattr(target, "AZURE_SPEECH_RESOURCE_ID", "/subs/123/resource")

    class FakeToken:
        token = "fake-aad-token"

    monkeypatch.setattr(target.credential, "get_token", lambda scope: FakeToken())

    class FakeTtsResponse:
        ok = True
        status_code = 200
        content = b"audio-bytes"
        text = ""

    captured = {}

    def fake_post(url, headers=None, data=None, timeout=None):
        captured["headers"] = headers
        return FakeTtsResponse()

    monkeypatch.setattr(target.requests, "post", fake_post)

    response = client.post(
        "/api/tts",
        json={"text": "Hello", "voice": "en-us-Jasper:MAI-Voice-1"},
    )

    assert response.status_code == 200
    assert captured["headers"]["Authorization"] == "Bearer aad#/subs/123/resource#fake-aad-token"
    assert "Ocp-Apim-Subscription-Key" not in captured["headers"]

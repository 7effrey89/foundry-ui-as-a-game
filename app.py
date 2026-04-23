from __future__ import annotations

import os
from typing import Any, Dict, Optional

import logging

import requests
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

APP_ROOT = os.path.dirname(os.path.abspath(__file__))

load_dotenv(os.path.join(APP_ROOT, ".env"), override=True)

FOUNDRY_SCOPE = os.getenv("FOUNDRY_SCOPE", "https://ai.azure.com")
FOUNDRY_PROJECT_ENDPOINT = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").rstrip("/")
FOUNDRY_MODEL_DEPLOYMENT = os.getenv("FOUNDRY_MODEL_DEPLOYMENT", "")
FOUNDRY_API_VERSION = os.getenv("FOUNDRY_API_VERSION", "") or "v1"
MAX_AUTH_RETRIES = 2

# Azure Speech Service (MAI-Voice-1 TTS)
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "")
AZURE_SPEECH_TTS_ENDPOINT = os.getenv("AZURE_SPEECH_TTS_ENDPOINT", "")
AZURE_SPEECH_RESOURCE_ID = os.getenv("AZURE_SPEECH_RESOURCE_ID", "")
AZURE_TENANT_ID = os.getenv("AZURE_TENANT_ID", "")

TTS_VOICES = [
    {"id": "en-us-Jasper:MAI-Voice-1", "label": "Jasper (Male)"},
    {"id": "en-us-June:MAI-Voice-1", "label": "June (Female)"},
    {"id": "en-us-Grant:MAI-Voice-1", "label": "Grant (Male)"},
    {"id": "en-us-Iris:MAI-Voice-1", "label": "Iris (Female)"},
    {"id": "en-us-Reed:MAI-Voice-1", "label": "Reed (Male)"},
    {"id": "en-us-Joy:MAI-Voice-1", "label": "Joy (Female)"},
]

logger = logging.getLogger(__name__)

credential = DefaultAzureCredential()

# In-memory per-agent metrics (reset on server restart)
_agent_metrics: Dict[str, Dict[str, Any]] = {}


def _record_metrics(agent_name: str, result: Dict[str, Any], error: bool = False) -> None:
    """Accumulate per-agent usage from a Foundry API response."""
    m = _agent_metrics.setdefault(agent_name, {
        "runs": 0,
        "errors": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "tool_calls": 0,
    })
    m["runs"] += 1
    if error:
        m["errors"] += 1
        return
    usage = result.get("usage") or {}
    m["prompt_tokens"] += usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0)
    m["completion_tokens"] += usage.get("output_tokens", 0) or usage.get("completion_tokens", 0)
    m["total_tokens"] += usage.get("total_tokens", 0)
    for item in result.get("output", []):
        if item.get("type", "").startswith("mcp_"):
            m["tool_calls"] += 1


app = Flask(__name__)


def _extract_response_text(result: Dict[str, Any]) -> str:
    output_text = result.get("output_text", "")
    if output_text:
        return output_text

    output = result.get("output", [])
    for item in output:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                output_text = content.get("text", "")
                if output_text:
                    return output_text
    return ""


def _build_trace_entries(result: Dict[str, Any]) -> list[Dict[str, Any]]:
    trace: list[Dict[str, Any]] = []
    for item in result.get("output", []):
        item_type = item.get("type", "event")
        if item_type == "message":
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    text = content.get("text", "")
                    if text:
                        trace.append(
                            {
                                "type": "message_output",
                                "summary": f"Agent response chunk: {text[:120]}",
                                "text": text,
                            }
                        )
        elif item_type == "reasoning":
            summary_items = item.get("summary", [])
            summary_text = " ".join(
                s.get("text", "").strip()
                for s in summary_items
                if isinstance(s, dict) and s.get("text")
            ).strip()
            if summary_text:
                trace.append(
                    {
                        "type": "reasoning",
                        "summary": f"Reasoning summary: {summary_text[:120]}",
                        "text": summary_text,
                    }
                )
        elif item_type == "mcp_approval_request":
            server = item.get("server_label", "unknown")
            name = item.get("name", "tool")
            trace.append(
                {
                    "type": "tool_approval_request",
                    "summary": f"Tool approval requested: {server}.{name}",
                    "server": server,
                    "name": name,
                    "approval_request_id": item.get("id", ""),
                }
            )
        elif item_type.startswith("mcp_"):
            trace.append(
                {
                    "type": item_type,
                    "summary": f"Tool event: {item_type}",
                }
            )
    return trace


def _get_token() -> str:
    global credential
    try:
        return credential.get_token(FOUNDRY_SCOPE).token
    except Exception:
        logger.warning("Credential failed, creating fresh DefaultAzureCredential")
        credential = DefaultAzureCredential()
        return credential.get_token(FOUNDRY_SCOPE).token


def foundry_request(path: str, method: str, body: Optional[Dict[str, Any]] = None) -> Any:
    if not FOUNDRY_PROJECT_ENDPOINT:
        raise ValueError("FOUNDRY_PROJECT_ENDPOINT is required.")

    url = f"{FOUNDRY_PROJECT_ENDPOINT}{path}"
    if "/v1/" not in path:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}api-version={FOUNDRY_API_VERSION}"

    last_error: Optional[Exception] = None
    for attempt in range(MAX_AUTH_RETRIES):
        try:
            token = _get_token()
        except Exception as exc:
            last_error = exc
            logger.warning("Auth attempt %d failed: %s", attempt + 1, exc)
            continue

        response = requests.request(
            method,
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=60,
        )

        if response.status_code == 401:
            logger.warning("Got 401 on attempt %d, refreshing credential", attempt + 1)
            credential = DefaultAzureCredential()
            last_error = RuntimeError(
                f"Foundry API error {response.status_code}: {response.text}"
            )
            continue

        if not response.ok:
            raise RuntimeError(
                f"Foundry API error {response.status_code}: {response.text}"
            )

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return None

    raise RuntimeError(
        f"Authentication failed after {MAX_AUTH_RETRIES} attempts: {last_error}"
    )


@app.route("/")
def index() -> Any:
    return send_from_directory(APP_ROOT, "index.html")


@app.route("/app.js")
def app_js() -> Any:
    return send_from_directory(APP_ROOT, "app.js")


@app.route("/styles.css")
def styles_css() -> Any:
    return send_from_directory(APP_ROOT, "styles.css")


@app.route("/assets/<path:filename>")
def serve_assets(filename: str) -> Any:
    return send_from_directory(os.path.join(APP_ROOT, "assets"), filename)


@app.route("/favicon.ico")
def favicon() -> Any:
    return ("", 204)


@app.get("/api/agents")
def list_agents() -> Any:
    if not FOUNDRY_PROJECT_ENDPOINT:
        return jsonify({"error": "FOUNDRY_PROJECT_ENDPOINT is not configured."}), 500
    try:
        result = foundry_request("/agents", "GET")
    except Exception as exc:
        return jsonify({"error": f"Failed to list agents: {exc}"}), 502
    agents = result.get("data", []) if isinstance(result, dict) else []
    out = []
    for a in agents:
        ver = (a.get("versions") or {}).get("latest") or {}
        defn = ver.get("definition") or {}
        tools_raw = defn.get("tools") or []

        tools = []
        knowledge = []
        memory = []
        for t in tools_raw:
            ttype = t.get("type", "")
            if ttype == "mcp":
                knowledge.append(t.get("server_label") or "knowledge")
            elif ttype == "memory_search_preview":
                memory.append(t.get("memory_store_name") or "memory")
            else:
                tools.append(ttype)

        rai = defn.get("rai_config") or {}
        guardrail = rai.get("rai_policy_name") or ""
        if "/" in guardrail:
            guardrail = guardrail.rsplit("/", 1)[-1]

        out.append({
            "id": a.get("id"),
            "name": a.get("name"),
            "instructions": defn.get("instructions") or "",
            "kind": defn.get("kind") or "",
            "model": defn.get("model") or "",
            "tools_raw": tools_raw,
            "tools": tools,
            "knowledge": knowledge,
            "memory": memory,
            "guardrail": guardrail,
            "rai_config": rai,
        })
    return jsonify(out)


@app.post("/api/agents")
def create_agent() -> Any:
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    instructions = (data.get("instructions") or "").strip()

    if not name or not instructions:
        return jsonify({"error": "Name and instructions are required."}), 400
    if not FOUNDRY_MODEL_DEPLOYMENT:
        return (
            jsonify({"error": "FOUNDRY_MODEL_DEPLOYMENT is required."}),
            500,
        )

    result = foundry_request(
        "/agents",
        "POST",
        {
            "name": name,
            "definition": {
                "kind": "prompt",
                "model": FOUNDRY_MODEL_DEPLOYMENT,
                "instructions": instructions,
            },
        },
    )
    return jsonify({"id": result.get("id"), "name": result.get("name")})


@app.post("/api/messages")
def send_message() -> Any:
    data = request.get_json(force=True) or {}
    agent_name = (data.get("agentName") or "").strip()
    message = (data.get("message") or "").strip()
    context = data.get("context") or []

    if not agent_name or not message:
        return jsonify({"error": "agentName and message are required."}), 400

    input_messages = []
    for ctx in context:
        if not isinstance(ctx, dict):
            continue
        role = (ctx.get("role") or "").strip()
        content = (ctx.get("content") or "").strip()
        if role in ("user", "assistant", "system") and content:
            input_messages.append({"role": role, "content": content})
    input_messages.append({"role": "user", "content": message})

    try:
        result = foundry_request(
            "/openai/v1/responses",
            "POST",
            {
                "agent_reference": {
                    "type": "agent_reference",
                    "name": agent_name,
                },
                "input": input_messages,
            },
        )
    except Exception as exc:
        _record_metrics(agent_name, {}, error=True)
        raise
    _record_metrics(agent_name, result)

    trace = [
        {
            "type": "input",
            "summary": f"User message sent to {agent_name}: {message[:120]}",
            "text": message,
        }
    ]
    trace.extend(_build_trace_entries(result))

    # Auto-approve MCP tool calls (knowledge base, etc.) up to 5 rounds
    for _ in range(5):
        approvals = [
            {"type": "mcp_approval_response", "approve": True, "approval_request_id": item["id"]}
            for item in result.get("output", [])
            if item.get("type") == "mcp_approval_request"
        ]
        if not approvals:
            break
        for approval in approvals:
            trace.append(
                {
                    "type": "tool_approval_response",
                    "summary": f"Tool approval granted: {approval['approval_request_id']}",
                    "approval_request_id": approval["approval_request_id"],
                    "approve": True,
                }
            )
        result = foundry_request(
            "/openai/v1/responses",
            "POST",
            {
                "model": result.get("model", ""),
                "agent_reference": {
                    "type": "agent_reference",
                    "name": agent_name,
                },
                "previous_response_id": result["id"],
                "input": approvals,
            },
        )
        _record_metrics(agent_name, result)
        trace.extend(_build_trace_entries(result))

    output_text = _extract_response_text(result)
    if output_text:
        trace.append(
            {
                "type": "final_response",
                "summary": f"Final response: {output_text[:120]}",
                "text": output_text,
            }
        )

    return jsonify(
        {
            "response": output_text or "No response received from agent.",
            "trace": trace,
            "usage": _agent_metrics.get(agent_name, {}),
        }
    )


@app.get("/api/metrics")
def get_metrics() -> Any:
    return jsonify(_agent_metrics)


def _get_tts_endpoint() -> str:
    """Build the MAI-Voice-1 TTS endpoint URL."""
    if AZURE_SPEECH_TTS_ENDPOINT:
        return AZURE_SPEECH_TTS_ENDPOINT.rstrip("/")
    if AZURE_SPEECH_REGION:
        return f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
    return ""


def _get_tts_headers(output_format: str = "audio-48khz-96kbitrate-mono-mp3") -> Dict[str, str]:
    """Build headers for MAI-Voice-1 TTS requests."""
    headers: Dict[str, str] = {
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": output_format,
        "User-Agent": "FoundryUI-Game",
    }
    if AZURE_SPEECH_KEY:
        headers["Ocp-Apim-Subscription-Key"] = AZURE_SPEECH_KEY
    else:
        # Fall back to DefaultAzureCredential (same credential used for Foundry)
        token = credential.get_token("https://cognitiveservices.azure.com/.default").token
        if AZURE_SPEECH_RESOURCE_ID:
            headers["Authorization"] = f"Bearer aad#{AZURE_SPEECH_RESOURCE_ID}#{token}"
        else:
            headers["Authorization"] = f"Bearer {token}"
    return headers


@app.get("/api/tts/status")
def tts_status() -> Any:
    endpoint = _get_tts_endpoint()
    # TTS is available whenever an endpoint can be resolved.
    # Auth uses AZURE_SPEECH_KEY if set, otherwise DefaultAzureCredential.
    return jsonify({
        "available": bool(endpoint),
        "voices": TTS_VOICES,
    })


@app.post("/api/tts")
def synthesize_speech() -> Any:
    data = request.get_json(force=True) or {}
    text = (data.get("text") or "").strip()
    voice = (data.get("voice") or "").strip()

    if not text:
        return jsonify({"error": "text is required."}), 400
    if not voice:
        return jsonify({"error": "voice is required."}), 400

    # Validate voice against known list
    valid_ids = {v["id"] for v in TTS_VOICES}
    if voice not in valid_ids:
        return jsonify({"error": f"Unknown voice: {voice}"}), 400

    endpoint = _get_tts_endpoint()
    if not endpoint:
        return jsonify({"error": "TTS endpoint is not configured."}), 500

    # Escape XML special characters in text
    safe_text = (text
                 .replace("&", "&amp;")
                 .replace("<", "&lt;")
                 .replace(">", "&gt;")
                 .replace('"', "&quot;")
                 .replace("'", "&apos;"))

    ssml = (
        '<speak version="1.0" '
        'xmlns="http://www.w3.org/2001/10/synthesis" '
        'xml:lang="en-US">'
        f'<voice name="{voice}">'
        f'{safe_text}'
        '</voice>'
        '</speak>'
    )

    try:
        headers = _get_tts_headers()
    except (ValueError, Exception) as exc:
        return jsonify({"error": str(exc)}), 500

    try:
        tts_response = requests.post(
            endpoint,
            headers=headers,
            data=ssml.encode("utf-8"),
            timeout=60,
        )

        # Retry with DefaultAzureCredential if key auth returns 401/403
        if (
            tts_response.status_code in (401, 403)
            and headers.get("Ocp-Apim-Subscription-Key")
        ):
            try:
                fallback_headers = {
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-48khz-96kbitrate-mono-mp3",
                    "User-Agent": "FoundryUI-Game",
                }
                token = credential.get_token("https://cognitiveservices.azure.com/.default").token
                if AZURE_SPEECH_RESOURCE_ID:
                    fallback_headers["Authorization"] = f"Bearer aad#{AZURE_SPEECH_RESOURCE_ID}#{token}"
                else:
                    fallback_headers["Authorization"] = f"Bearer {token}"
                tts_response = requests.post(
                    endpoint,
                    headers=fallback_headers,
                    data=ssml.encode("utf-8"),
                    timeout=60,
                )
            except Exception:
                pass

        if not tts_response.ok:
            return jsonify({"error": f"TTS API error {tts_response.status_code}: {tts_response.text[:300]}"}), 502

        from flask import Response
        return Response(
            tts_response.content,
            mimetype="audio/mpeg",
            headers={"Content-Type": "audio/mpeg"},
        )

    except Exception as exc:
        return jsonify({"error": f"TTS request failed: {exc}"}), 502


@app.errorhandler(Exception)
def handle_exception(error: Exception) -> Any:
    return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=4173, debug=True)

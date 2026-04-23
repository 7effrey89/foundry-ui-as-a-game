from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

APP_ROOT = os.path.dirname(os.path.abspath(__file__))

load_dotenv(os.path.join(APP_ROOT, ".env"), override=True)

FOUNDRY_SCOPE = os.getenv("FOUNDRY_SCOPE", "https://ai.azure.com")
FOUNDRY_PROJECT_ENDPOINT = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").rstrip("/")
FOUNDRY_MODEL_DEPLOYMENT = os.getenv("FOUNDRY_MODEL_DEPLOYMENT", "")
FOUNDRY_API_VERSION = os.getenv("FOUNDRY_API_VERSION", "v1")

credential = DefaultAzureCredential()

app = Flask(__name__)


def foundry_request(path: str, method: str, body: Optional[Dict[str, Any]] = None) -> Any:
    if not FOUNDRY_PROJECT_ENDPOINT:
        raise ValueError("FOUNDRY_PROJECT_ENDPOINT is required.")

    token = credential.get_token(FOUNDRY_SCOPE).token
    url = f"{FOUNDRY_PROJECT_ENDPOINT}{path}"
    if "/v1/" not in path:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}api-version={FOUNDRY_API_VERSION}"

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

    if not response.ok:
        raise RuntimeError(
            f"Foundry API error {response.status_code}: {response.text}"
        )

    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return response.json()
    return None


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
    return jsonify(
        [{"id": a.get("id"), "name": a.get("name")} for a in agents]
    )


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

    if not agent_name or not message:
        return jsonify({"error": "agentName and message are required."}), 400

    result = foundry_request(
        "/openai/v1/responses",
        "POST",
        {
            "agent_reference": {
                "type": "agent_reference",
                "name": agent_name,
            },
            "input": [{"role": "user", "content": message}],
        },
    )

    output_text = result.get("output_text", "")
    if not output_text:
        output = result.get("output", [])
        for item in output:
            if item.get("type") == "message":
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        output_text = content.get("text", "")
                        break
                if output_text:
                    break

    return jsonify({"response": output_text or "No response received from agent."})


@app.errorhandler(Exception)
def handle_exception(error: Exception) -> Any:
    return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=4173, debug=True)

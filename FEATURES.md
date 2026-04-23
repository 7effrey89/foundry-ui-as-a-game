# Features

## Experience
- Isometric pixel-art office displayed as a pre-rendered background image.
- Name labels and speech bubbles overlay the background at desk positions.
- Status dots (blue = user, green = awake, amber = napping, grey = empty) indicate desk state.
- Player avatar and NPC agents appear at designated desk hotspots.
- NPC agents switch between awake and sleeping visual states.

## Agents and Workflow
- Create NPCs that map to Azure AI Foundry agents.
- Load existing Foundry agents from the server into the NPC list.
- Agent cards display attached tools, knowledge sources, memory stores, and guardrails as colored badges.
- Chat directly with a specific agent via the per-agent input field.
- Enable/disable agents to control which desks are online.
- Agent speech bubbles can show observability snippets (tool approvals/reasoning summaries) during conversations.
- Agent cards show a metrics badge (run count + total tokens) once an agent has been used.
- Agent detail modal includes an **Operational Metrics** section: runs, errors, error rate, prompt/completion/total tokens, and tool calls.
- Five orchestration patterns from the [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/), selectable via the UI:
  - **Concurrent**: All agents process the same message simultaneously and independently.
  - **Sequential**: Agents execute in pipeline order, each building on the previous output.
    - Context passing mode: `previous_response` (prior output only) or `append_history` (full chain).
  - **Handoff**: A triage agent dynamically routes conversations to specialist agents based on context.
    - Configurable triage agent selection.
  - **Group Chat**: Agents collaborate round-robin in a shared conversation with configurable max rounds.
  - **Magentic**: A manager agent coordinates specialized workers through dynamic delegation.
    - Configurable manager agent selection.
- Orchestration info panel shows description, flow pattern, use cases, and documentation link for the selected pattern.

## Server-Side Foundry Integration
- Flask backend handles Foundry API requests.
- `GET /api/agents` lists existing Foundry agents.
- `POST /api/agents` creates a new Foundry agent.
- `POST /api/messages` sends a message to a specific agent.
- `POST /api/messages` accepts optional `context` array for multi-turn conversation history.
- `POST /api/messages` returns both final `response` and chronological `trace` events for observability.
- `POST /api/messages` returns per-agent `usage` metrics (runs, tokens, errors, tool calls) accumulated across the session.
- `GET /api/metrics` returns aggregated per-agent operational metrics.
- Uses Azure `DefaultAzureCredential` for Entra authentication without API keys.
- Configurable token scope via `FOUNDRY_SCOPE` (defaults to `https://ai.azure.com`).
- Agent creation uses the new Foundry Agents API (`api-version=v1`) with `definition.kind=prompt`.
- Messaging uses the OpenAI-compatible `/openai/v1/responses` endpoint with `agent_reference`.

## Configuration
- Foundry settings provided via `.env` or environment variables.
- Required: `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_DEPLOYMENT`.
- Optional: `FOUNDRY_API_VERSION` (defaults to `v1`), `FOUNDRY_SCOPE`.

## Text-to-Speech (MAI-Voice-1)
- Optional TTS feature: agents speak their responses aloud using Azure Speech Service (MAI-Voice-1).
- Each agent is assigned a distinct voice actor from the MAI-Voice-1 prebuilt voice roster (Jasper, June, Grant, Iris, Reed, Joy).
- Voice assignments are configurable per-agent via the Settings modal.
- Settings button in the sidebar footer opens a lightbox to toggle TTS and manage voice assignments.
- TTS is gracefully optional: the app works normally when Speech credentials are not configured.
- Audio responses are queued and played sequentially to avoid overlap.
- A 🔊 icon appears on the agent's speech bubble while audio is playing.
- `GET /api/tts/status` reports whether TTS is available and lists voices.
- `POST /api/tts` synthesizes speech from text using the selected MAI-Voice-1 voice.
- Supports key-based auth (`AZURE_SPEECH_KEY`) or automatic `DefaultAzureCredential` fallback (no key required).
- When `AZURE_SPEECH_RESOURCE_ID` is set, uses `aad#resource_id#token` auth format; otherwise uses plain Bearer token.
- Optional: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_TTS_ENDPOINT`, `AZURE_SPEECH_RESOURCE_ID`.

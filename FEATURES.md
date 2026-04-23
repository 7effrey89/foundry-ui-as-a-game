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
- Group workflow: all enabled agents respond to a broadcast message.
- Sequential workflow: enabled agents respond in order and pass context.
- Sequential handoff mode is configurable from the UI:
  - `previous_response`: pass only the prior agent response
  - `append_history`: pass the original message plus prior response
- Enable/disable agents to control which desks are online.
- Agent speech bubbles can show observability snippets (tool approvals/reasoning summaries) during conversations.

## Server-Side Foundry Integration
- Flask backend handles Foundry API requests.
- `GET /api/agents` lists existing Foundry agents.
- `POST /api/agents` creates a new Foundry agent.
- `POST /api/messages` sends a message to a specific agent.
- `POST /api/messages` returns both final `response` and chronological `trace` events for observability.
- Uses Azure `DefaultAzureCredential` for Entra authentication without API keys.
- Configurable token scope via `FOUNDRY_SCOPE` (defaults to `https://ai.azure.com`).
- Agent creation uses the new Foundry Agents API (`api-version=v1`) with `definition.kind=prompt`.
- Messaging uses the OpenAI-compatible `/openai/v1/responses` endpoint with `agent_reference`.

## Configuration
- Foundry settings provided via `.env` or environment variables.
- Required: `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_DEPLOYMENT`.
- Optional: `FOUNDRY_API_VERSION` (defaults to `v1`), `FOUNDRY_SCOPE`.

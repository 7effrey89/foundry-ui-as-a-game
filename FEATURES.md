# Features

## Experience
- Pixel-styled office scene with desks and sprite characters.
- Player avatar speaks via a bubble over their desk.
- NPC agents appear at desks when created and switch between awake/sleeping states.

## Agents and Workflow
- Create NPCs that map to Azure AI Foundry agents.
- Group workflow: all enabled agents respond.
- Sequential workflow: enabled agents respond in order and pass context.
- Enable/disable agents to control which desks are online.

## Server-Side Foundry Integration
- Flask backend handles Foundry API requests.
- Uses Azure `DefaultAzureCredential` for Entra authentication without API keys.
- Configurable token scope via `FOUNDRY_SCOPE` (defaults to `https://ai.azure.com/.default`).
- Agent creation uses the new Foundry Agents API (`api-version=v1`) with `definition.kind=prompt`.
- Messaging uses the OpenAI-compatible `/openai/v1/responses` endpoint with `agent_reference`.

## Configuration
- Foundry settings provided via `.env` or environment variables.
- Required: `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_DEPLOYMENT`.
- Optional: `FOUNDRY_API_VERSION` (defaults to `v1`), `FOUNDRY_SCOPE`.

# foundry-ui-as-a-game

A browser-based, pixel-styled office UI for visually demonstrating Azure AI Foundry multi-agent behavior.

## What this implements

- Isometric-like office scene with desks and sprite characters
- Player avatar that speaks in a bubble above their character
- NPC creation from the UI that creates an Azure AI Foundry Agent
  - NPC name -> agent name
  - NPC description -> agent system prompt/instructions
- Entra ID authentication via Azure DefaultAzureCredential on the Flask server (no API key inputs and no API-key auth path)
- Message routing to agents with workflow strategies:
  - **Group**: all enabled agents respond
  - **Sequential**: enabled agents respond in order
- Agent enable/disable:
  - enabled = online at desk
  - disabled = sleeping/nap state at desk
  - unassigned desks remain empty

## Run locally

This app now runs with a Flask backend for server-side authentication.

```bash
cd foundry-ui-as-a-game
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Set environment variables for Foundry (or edit the `.env` file in the repo root; it is loaded automatically on startup):

```bash
export FOUNDRY_PROJECT_ENDPOINT="https://<resource>.services.ai.azure.com/api/projects/<project>"
export FOUNDRY_MODEL_DEPLOYMENT="gpt-4o-mini"
export FOUNDRY_API_VERSION="2024-05-01-preview"
```

PowerShell:

```powershell
$env:FOUNDRY_PROJECT_ENDPOINT="https://<resource>.services.ai.azure.com/api/projects/<project>"
$env:FOUNDRY_MODEL_DEPLOYMENT="gpt-4o-mini"
$env:FOUNDRY_API_VERSION="2024-05-01-preview"
```

Authenticate with Azure (one of the supported DefaultAzureCredential methods):

```bash
az login
```

Run the server:

```bash
python app.py
```

Open `http://localhost:4173` in a browser.

## Configure in UI

After the server is running and authenticated:
- Create NPCs (which creates Foundry agents)
- Pick workflow mode (group/sequential)
- Send messages and watch bubbles over each character

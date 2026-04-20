# foundry-ui-as-a-game

A browser-based, pixel-styled office UI for visually demonstrating Azure AI Foundry multi-agent behavior.

## What this implements

- Isometric-like office scene with desks and sprite characters
- Player avatar that speaks in a bubble above their character
- NPC creation from the UI that creates an Azure AI Foundry Agent
  - NPC name -> agent name
  - NPC description -> agent system prompt/instructions
- Entra ID authentication via MSAL (no API key inputs and no API-key auth path)
- Message routing to agents with workflow strategies:
  - **Group**: all enabled agents respond
  - **Sequential**: enabled agents respond in order
- Agent enable/disable:
  - enabled = online at desk
  - disabled = sleeping/nap state at desk
  - unassigned desks remain empty

## Run locally

Because this is a static app, you can run it with a simple local web server:

```bash
cd /home/runner/work/foundry-ui-as-a-game/foundry-ui-as-a-game
python3 -m http.server 4173
```

Open `http://localhost:4173` in a browser.

## Configure in UI

1. Enter **Tenant ID** and **Client ID** for your Entra app registration.
2. Enter Foundry scope (default: `https://cognitiveservices.azure.com/.default`).
3. Enter Foundry **Project Endpoint**.
4. Enter **Model Deployment** used for agent creation.
5. Keep/update **API Version**.
6. Click **Login with Entra**.

After login:
- Create NPCs (which creates Foundry agents)
- Pick workflow mode (group/sequential)
- Send messages and watch bubbles over each character

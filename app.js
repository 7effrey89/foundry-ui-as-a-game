(() => {
  const MAX_RUN_POLL_ATTEMPTS = 15;
  const RUN_POLL_INTERVAL_MS = 1000;
  const RUN_POLL_TIMEOUT_MS = MAX_RUN_POLL_ATTEMPTS * RUN_POLL_INTERVAL_MS;

  const state = {
    user: {
      name: 'You',
      speech: 'Hello office!',
      deskIndex: 0
    },
    workflowMode: 'group',
    agents: [],
    msalInstance: null,
    account: null,
    accessToken: null
  };

  const DESKS = [
    { x: 90, y: 90 },
    { x: 270, y: 90 },
    { x: 450, y: 90 },
    { x: 170, y: 220 },
    { x: 350, y: 220 },
    { x: 530, y: 220 }
  ];

  const ids = {
    tenantId: document.getElementById('tenantId'),
    clientId: document.getElementById('clientId'),
    scope: document.getElementById('scope'),
    projectEndpoint: document.getElementById('projectEndpoint'),
    modelDeployment: document.getElementById('modelDeployment'),
    apiVersion: document.getElementById('apiVersion'),
    loginBtn: document.getElementById('loginBtn'),
    authStatus: document.getElementById('authStatus'),
    npcName: document.getElementById('npcName'),
    npcDescription: document.getElementById('npcDescription'),
    createNpcBtn: document.getElementById('createNpcBtn'),
    workflowMode: document.getElementById('workflowMode'),
    userMessage: document.getElementById('userMessage'),
    sendMessageBtn: document.getElementById('sendMessageBtn'),
    agentList: document.getElementById('agentList'),
    office: document.getElementById('office'),
    eventLog: document.getElementById('eventLog')
  };

  function setLog(message) {
    ids.eventLog.textContent = message;
  }

  function createLocalId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function settings() {
    return {
      tenantId: ids.tenantId.value.trim(),
      clientId: ids.clientId.value.trim(),
      scope: ids.scope.value.trim(),
      projectEndpoint: ids.projectEndpoint.value.trim().replace(/\/$/, ''),
      modelDeployment: ids.modelDeployment.value.trim(),
      apiVersion: ids.apiVersion.value.trim()
    };
  }

  async function ensureAuth() {
    const s = settings();
    if (!s.tenantId || !s.clientId || !s.scope) {
      throw new Error('Tenant ID, Client ID and scope are required for Entra sign-in.');
    }

    if (!window.msal || !window.msal.PublicClientApplication) {
      throw new Error('MSAL library failed to load.');
    }

    if (!state.msalInstance) {
      state.msalInstance = new window.msal.PublicClientApplication({
        auth: {
          clientId: s.clientId,
          authority: `https://login.microsoftonline.com/${s.tenantId}`,
          redirectUri: window.location.origin + window.location.pathname
        },
        cache: {
          cacheLocation: 'sessionStorage'
        }
      });
      await state.msalInstance.initialize();
    }

    if (!state.account) {
      const loginResult = await state.msalInstance.loginPopup({ scopes: [s.scope] });
      state.account = loginResult.account;
    }

    const token = await state.msalInstance.acquireTokenSilent({
      account: state.account,
      scopes: [s.scope]
    }).catch(async () => state.msalInstance.acquireTokenPopup({ scopes: [s.scope] }));

    state.accessToken = token.accessToken;
    ids.authStatus.textContent = `Signed in as ${state.account.username || state.account.name || 'user'}`;
    return state.accessToken;
  }

  async function foundryRequest(path, method, body) {
    const s = settings();
    if (!s.projectEndpoint || !s.apiVersion) {
      throw new Error('Project endpoint and API version are required.');
    }

    const token = await ensureAuth();
    const response = await fetch(`${s.projectEndpoint}${path}${path.includes('?') ? '&' : '?'}api-version=${encodeURIComponent(s.apiVersion)}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Foundry API error ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : null;
  }

  async function createFoundryAgent(name, description) {
    const s = settings();
    if (!s.modelDeployment) {
      throw new Error('Model deployment is required to create agents.');
    }

    const result = await foundryRequest('/agents', 'POST', {
      name,
      model: s.modelDeployment,
      instructions: description
    });

    return result.id;
  }

  async function sendMessageToFoundryAgent(agent, message) {
    const thread = await foundryRequest('/threads', 'POST', {});
    await foundryRequest(`/threads/${thread.id}/messages`, 'POST', {
      role: 'user',
      content: message
    });

    const run = await foundryRequest(`/threads/${thread.id}/runs`, 'POST', {
      assistant_id: agent.foundryAgentId
    });

    let completed = false;
    for (let i = 0; i < MAX_RUN_POLL_ATTEMPTS; i += 1) {
      const runStatus = await foundryRequest(`/threads/${thread.id}/runs/${run.id}`, 'GET');
      if (runStatus.status === 'completed') {
        completed = true;
        break;
      }
      if (runStatus.status === 'failed' || runStatus.status === 'cancelled' || runStatus.status === 'expired') {
        throw new Error(`Run ended with status: ${runStatus.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
    }
    if (!completed) {
      throw new Error(`${agent.name} did not complete within ${RUN_POLL_TIMEOUT_MS / 1000} seconds.`);
    }

    const messages = await foundryRequest(`/threads/${thread.id}/messages?order=desc`, 'GET');
    const assistantMessage = (messages.data || []).find((m) => m.role === 'assistant');
    const textValue = assistantMessage?.content?.[0]?.text?.value;
    return textValue || 'No response received from agent.';
  }

  function getDeskForAgent(index) {
    return DESKS[(index + 1) % DESKS.length];
  }

  function renderAgentsPanel() {
    ids.agentList.innerHTML = '';
    if (!state.agents.length) {
      ids.agentList.innerHTML = '<p class="status">No NPC agents yet. Create one above.</p>';
      return;
    }

    state.agents.forEach((agent) => {
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.innerHTML = `
        <div class="agent-name">${agent.name}</div>
        <div class="status">${agent.enabled ? 'Online at desk' : 'Sleeping at desk'}</div>
        <label>
          <input type="checkbox" ${agent.enabled ? 'checked' : ''} data-agent-toggle="${agent.id}" />
          Enabled
        </label>
      `;
      ids.agentList.appendChild(card);
    });
  }

  function createDeskElement({ x, y }, label, spriteClass, bubbleText) {
    const desk = document.createElement('div');
    desk.className = 'desk';
    desk.style.left = `${x}px`;
    desk.style.top = `${y}px`;

    const name = document.createElement('div');
    name.className = 'label';
    name.textContent = label;

    const chair = document.createElement('div');
    chair.className = 'chair';

    const sprite = document.createElement('div');
    sprite.className = `sprite ${spriteClass}`;

    desk.appendChild(name);
    desk.appendChild(chair);
    desk.appendChild(sprite);

    if (bubbleText) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = bubbleText;
      sprite.appendChild(bubble);
    }

    return desk;
  }

  function renderOffice() {
    ids.office.innerHTML = '';
    const floor = document.createElement('div');
    floor.className = 'floor';
    ids.office.appendChild(floor);

    const userDesk = DESKS[state.user.deskIndex];
    ids.office.appendChild(createDeskElement(userDesk, state.user.name, 'user', state.user.speech));

    state.agents.forEach((agent, index) => {
      const desk = getDeskForAgent(index);
      const spriteClass = agent.enabled ? 'awake' : 'nap';
      const bubble = agent.enabled ? agent.lastSpeech : 'Zzz...';
      ids.office.appendChild(createDeskElement(desk, agent.name, spriteClass, bubble));
    });

    for (let i = state.agents.length + 1; i < DESKS.length; i += 1) {
      ids.office.appendChild(createDeskElement(DESKS[i], 'Empty Seat', 'empty'));
    }
  }

  async function handleCreateNpc() {
    const name = ids.npcName.value.trim();
    const description = ids.npcDescription.value.trim();
    if (!name || !description) {
      setLog('NPC name and description are required.');
      return;
    }

    try {
      setLog(`Creating Foundry agent "${name}"...`);
      const foundryAgentId = await createFoundryAgent(name, description);
      state.agents.push({
        id: createLocalId(),
        name,
        description,
        foundryAgentId,
        enabled: true,
        lastSpeech: 'Ready to help!'
      });
      ids.npcName.value = '';
      ids.npcDescription.value = '';
      renderAgentsPanel();
      renderOffice();
      setLog(`Created NPC "${name}" (Foundry ID: ${foundryAgentId}).`);
    } catch (error) {
      setLog(error.message);
    }
  }

  async function processMessageThroughWorkflow(message) {
    const enabledAgents = state.agents.filter((a) => a.enabled);
    if (!enabledAgents.length) {
      setLog('No enabled agents are online.');
      return;
    }

    if (state.workflowMode === 'group') {
      const results = await Promise.allSettled(enabledAgents.map(async (agent) => {
        try {
          const response = await sendMessageToFoundryAgent(agent, message);
          agent.lastSpeech = response;
        } catch (error) {
          throw new Error(`${agent.name} failed in group workflow: ${error.message}`);
        }
      }));

      const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason.message);
      if (failures.length) {
        throw new Error(failures.join(' | '));
      }
      return;
    }

    let rollingMessage = message;
    for (const agent of enabledAgents) {
      try {
        const response = await sendMessageToFoundryAgent(agent, rollingMessage);
        agent.lastSpeech = response;
        rollingMessage = `Previous agent response: ${response}`;
      } catch (error) {
        throw new Error(`${agent.name} failed in sequential workflow: ${error.message}`);
      }
    }
  }

  async function handleSendMessage() {
    const message = ids.userMessage.value.trim();
    if (!message) {
      return;
    }

    state.user.speech = message;
    renderOffice();
    setLog(`You said: "${message}"`);

    try {
      await processMessageThroughWorkflow(message);
      renderOffice();
      setLog(`Workflow "${state.workflowMode}" complete.`);
    } catch (error) {
      setLog(error.message);
    }
  }

  ids.loginBtn.addEventListener('click', async () => {
    try {
      await ensureAuth();
      setLog('Authentication complete.');
    } catch (error) {
      setLog(error.message);
    }
  });

  ids.createNpcBtn.addEventListener('click', handleCreateNpc);
  ids.sendMessageBtn.addEventListener('click', handleSendMessage);
  ids.workflowMode.addEventListener('change', () => {
    state.workflowMode = ids.workflowMode.value;
    setLog(`Workflow set to ${state.workflowMode}.`);
  });

  ids.agentList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.agentToggle === undefined) {
      return;
    }

    const agent = state.agents.find((a) => a.id === target.dataset.agentToggle);
    if (!agent) {
      return;
    }

    agent.enabled = target.checked;
    renderAgentsPanel();
    renderOffice();
    setLog(`${agent.name} is now ${agent.enabled ? 'online' : 'sleeping'} at their desk.`);
  });

  renderAgentsPanel();
  renderOffice();
})();

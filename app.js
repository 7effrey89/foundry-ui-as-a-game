(() => {
  const state = {
    user: {
      name: 'You',
      speech: 'Hello office!',
      deskIndex: 0
    },
    workflowMode: 'group',
    agents: []
  };

  const API_BASE = '/api';

  const DESKS = [
    { x: 155, y: 290 },
    { x: 310, y: 290 },
    { x: 560, y: 290 },
    { x: 155, y: 420 },
    { x: 310, y: 420 },
    { x: 560, y: 420 }
  ];

  const ids = {
    npcName: document.getElementById('npcName'),
    npcDescription: document.getElementById('npcDescription'),
    createNpcBtn: document.getElementById('createNpcBtn'),
    loadAgentsBtn: document.getElementById('loadAgentsBtn'),
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

  async function foundryRequest(path, method, body) {
    const options = {
      method,
      headers: {}
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${path}`, options);

    if (!response.ok) {
      let message = `Server error ${response.status}`;
      try {
        const data = await response.json();
        if (data.error) message = data.error;
      } catch {
        message += `: ${await response.text()}`;
      }
      throw new Error(message);
    }

    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : null;
  }

  async function createFoundryAgent(name, description) {
    const result = await foundryRequest('/agents', 'POST', {
      name,
      instructions: description
    });

    return { id: result.id, name: result.name || name };
  }

  async function sendMessageToFoundryAgent(agent, message) {
    const result = await foundryRequest('/messages', 'POST', {
      agentName: agent.foundryAgentName,
      message
    });
    return result?.response || 'No response received from agent.';
  }

  async function fetchAgents() {
    const agents = await foundryRequest('/agents', 'GET');
    if (!Array.isArray(agents)) return [];
    return agents;
  }

  async function handleSendToAgent(agentId) {
    const input = document.querySelector(`[data-agent-input="${agentId}"]`);
    if (!input) return;
    const message = input.value.trim();
    if (!message) return;

    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent || !agent.enabled) {
      setLog(`Agent is not available.`);
      return;
    }

    state.user.speech = message;
    renderOffice();
    setLog(`You said to ${agent.name}: "${message}"`);

    try {
      const response = await sendMessageToFoundryAgent(agent, message);
      agent.lastSpeech = response;
      renderOffice();
      renderAgentsPanel();
      setLog(`${agent.name} responded.`);
    } catch (error) {
      setLog(error.message);
    }
  }

  function getDeskForAgent(index) {
    return DESKS[(index + 1) % DESKS.length];
  }

  function renderAgentsPanel() {
    ids.agentList.innerHTML = '';
    if (!state.agents.length) {
      ids.agentList.innerHTML = '<p class="status">No NPC agents yet. Create one above or load existing agents.</p>';
      return;
    }

    state.agents.forEach((agent) => {
      const card = document.createElement('div');
      card.className = 'agent-card';

      const escapedName = agent.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const escapedSpeech = (agent.lastSpeech || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

      card.innerHTML = `
        <div class="agent-name">${escapedName}</div>
        <div class="status">${agent.enabled ? 'Online at desk' : 'Sleeping at desk'}</div>
        <label>
          <input type="checkbox" ${agent.enabled ? 'checked' : ''} data-agent-toggle="${agent.id}" />
          Enabled
        </label>
        <div class="agent-chat">
          <div class="agent-last-speech">${escapedSpeech ? '💬 ' + escapedSpeech : ''}</div>
          <div class="row agent-chat-row">
            <input data-agent-input="${agent.id}" placeholder="Say something to ${escapedName}..." />
            <button data-agent-send="${agent.id}">Chat</button>
          </div>
        </div>
      `;
      ids.agentList.appendChild(card);
    });
  }

  function createDeskElement({ x, y }, label, spriteClass, bubbleText) {
    const desk = document.createElement('div');
    desk.className = 'iso-desk';
    desk.style.left = `${x}px`;
    desk.style.top = `${y}px`;

    const name = document.createElement('div');
    name.className = 'iso-label';
    name.textContent = label;
    desk.appendChild(name);

    const dot = document.createElement('div');
    dot.className = `desk-status ${spriteClass}`;
    desk.appendChild(dot);

    if (bubbleText) {
      const bubble = document.createElement('div');
      bubble.className = 'px-bubble';
      bubble.textContent = bubbleText;
      desk.appendChild(bubble);
    }

    return desk;
  }

  function renderOffice() {
    ids.office.innerHTML = '';

    const scene = document.createElement('div');
    scene.className = 'iso-scene';

    // Desks (overlay labels + bubbles on background image)
    const userDesk = DESKS[state.user.deskIndex];
    scene.appendChild(createDeskElement(userDesk, state.user.name, 'user', state.user.speech));

    state.agents.forEach((agent, index) => {
      const desk = getDeskForAgent(index);
      const spriteClass = agent.enabled ? 'awake' : 'nap';
      const bubble = agent.enabled ? agent.lastSpeech : 'Zzz...';
      scene.appendChild(createDeskElement(desk, agent.name, spriteClass, bubble));
    });

    for (let i = state.agents.length + 1; i < DESKS.length; i += 1) {
      scene.appendChild(createDeskElement(DESKS[i], 'Empty Seat', 'empty'));
    }

    ids.office.appendChild(scene);
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
      const foundryAgent = await createFoundryAgent(name, description);
      state.agents.push({
        id: createLocalId(),
        name,
        description,
        foundryAgentId: foundryAgent.id,
        foundryAgentName: foundryAgent.name,
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
          throw new Error(`Agent ${agent.name} failed in group workflow: ${error.message}`);
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
        throw new Error(`Agent ${agent.name} failed in sequential workflow: ${error.message}`);
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

  ids.createNpcBtn.addEventListener('click', handleCreateNpc);
  ids.sendMessageBtn.addEventListener('click', handleSendMessage);
  ids.loadAgentsBtn.addEventListener('click', async () => {
    try {
      setLog('Loading existing Foundry agents...');
      const remoteAgents = await fetchAgents();
      if (!remoteAgents.length) {
        setLog('No existing agents found.');
        return;
      }

      let added = 0;
      remoteAgents.forEach((ra) => {
        const alreadyExists = state.agents.some(
          (a) => a.foundryAgentId === ra.id || a.foundryAgentName === ra.name
        );
        if (!alreadyExists) {
          state.agents.push({
            id: createLocalId(),
            name: ra.name,
            description: '',
            foundryAgentId: ra.id,
            foundryAgentName: ra.name,
            enabled: true,
            lastSpeech: 'Ready to help!'
          });
          added += 1;
        }
      });
      renderAgentsPanel();
      renderOffice();
      setLog(`Loaded ${added} new agent(s) from Foundry (${remoteAgents.length} total).`);
    } catch (error) {
      setLog(error.message);
    }
  });
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

  ids.agentList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.dataset.agentSend === undefined) {
      return;
    }
    handleSendToAgent(target.dataset.agentSend);
  });

  ids.agentList.addEventListener('keydown', (event) => {
    const target = event.target;
    if (event.key !== 'Enter' || !(target instanceof HTMLInputElement) || target.dataset.agentInput === undefined) {
      return;
    }
    handleSendToAgent(target.dataset.agentInput);
  });

  renderAgentsPanel();
  renderOffice();
})();

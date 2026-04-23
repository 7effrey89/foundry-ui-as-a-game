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
    { x: 90, y: 90 },
    { x: 270, y: 90 },
    { x: 450, y: 90 },
    { x: 170, y: 220 },
    { x: 350, y: 220 },
    { x: 530, y: 220 }
  ];

  const ids = {
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

  async function foundryRequest(path, method, body) {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server error ${response.status}: ${text}`);
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

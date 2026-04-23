(() => {
  const state = {
    user: {
      name: 'You',
      speech: 'Hello office!',
      deskIndex: 0
    },
    workflowMode: 'group',
    handoffMode: 'previous_response',
    trace: [],
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

  const THINKING_PHRASES = [
    'Thinking...', 'Looking at tools...',
    'Searching knowledge base...', 'Processing...',
    'Reading documents...', 'Analyzing...',
    'Consulting sources...', 'Hmm...',
    'Let me check...', 'One moment...'
  ];

  const DOT_SEQUENCE = ['.', '..', '...'];

  function startThinking(agentId) {
    let tick = 0;
    const update = () => {
      const dotIndex = tick % (DOT_SEQUENCE.length + 1);
      const phrase = dotIndex < DOT_SEQUENCE.length
        ? DOT_SEQUENCE[dotIndex]
        : THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
      tick++;
      const bubble = document.querySelector(`[data-agent-bubble="${agentId}"]`);
      if (bubble) { bubble.textContent = phrase; bubble.classList.add('thinking'); }
      const speech = document.querySelector(`[data-agent-speech="${agentId}"]`);
      if (speech) speech.textContent = '\ud83d\udcac ' + phrase;
    };
    update();
    const interval = setInterval(update, 800);
    return () => {
      clearInterval(interval);
      const bubble = document.querySelector(`[data-agent-bubble="${agentId}"]`);
      if (bubble) bubble.classList.remove('thinking');
    };
  }

  const ids = {
    npcName: document.getElementById('npcName'),
    npcDescription: document.getElementById('npcDescription'),
    createNpcBtn: document.getElementById('createNpcBtn'),
    loadAgentsBtn: document.getElementById('loadAgentsBtn'),
    workflowMode: document.getElementById('workflowMode'),
    handoffMode: document.getElementById('handoffMode'),
    userMessage: document.getElementById('userMessage'),
    sendMessageBtn: document.getElementById('sendMessageBtn'),
    agentList: document.getElementById('agentList'),
    office: document.getElementById('office'),
    eventLog: document.getElementById('eventLog'),
    traceList: document.getElementById('traceList'),
    clearTraceBtn: document.getElementById('clearTraceBtn')
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
    return foundryRequest('/messages', 'POST', {
      agentName: agent.foundryAgentName,
      message
    });
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

    const stopThinking = startThinking(agent.id);
    try {
      const result = await sendMessageToFoundryAgent(agent, message);
      stopThinking();
      const response = result?.response || 'No response received from agent.';
      agent.lastSpeech = response;
      addTraceEntries(agent, result, 'direct');
      renderOffice();
      renderAgentsPanel();
      setLog(`${agent.name} responded.`);
    } catch (error) {
      stopThinking();
      setLog(error.message);
    }
  }

  function getDeskForAgent(index) {
    return DESKS[(index + 1) % DESKS.length];
  }

  function shortText(value, max = 140) {
    if (!value) return '';
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...`;
  }

  function formatTime(date = new Date()) {
    return date.toLocaleTimeString();
  }

  function renderTracePanel() {
    if (!ids.traceList) return;
    ids.traceList.innerHTML = '';
    if (!state.trace.length) {
      const empty = document.createElement('p');
      empty.className = 'status';
      empty.textContent = 'No trace events yet.';
      ids.traceList.appendChild(empty);
      return;
    }

    state.trace.forEach((entry) => {
      const item = document.createElement('article');
      item.className = 'trace-item';

      const meta = document.createElement('div');
      meta.className = 'trace-meta';
      meta.textContent = `${entry.time} • ${entry.agentName} • ${entry.type}`;

      const summary = document.createElement('div');
      summary.className = 'trace-summary';
      summary.textContent = entry.summary;

      item.appendChild(meta);
      item.appendChild(summary);
      ids.traceList.appendChild(item);
    });
  }

  function addTrace(entry) {
    state.trace.push({
      time: formatTime(),
      ...entry
    });
    if (state.trace.length > 300) {
      state.trace = state.trace.slice(state.trace.length - 300);
    }
    renderTracePanel();
  }

  function addTraceEntries(agent, result, channel) {
    const traceEntries = Array.isArray(result?.trace) ? result.trace : [];
    if (!traceEntries.length) {
      return;
    }

    traceEntries.forEach((entry) => {
      addTrace({
        agentName: agent.name,
        agentId: agent.id,
        type: entry.type || channel,
        summary: entry.summary || shortText(entry.text || '')
      });
    });

    let latestForBubble = null;
    for (let i = traceEntries.length - 1; i >= 0; i -= 1) {
      const entry = traceEntries[i];
      if (entry.type === 'tool_approval_request' || entry.type === 'tool_approval_response' || entry.type === 'reasoning') {
        latestForBubble = entry;
        break;
      }
    }
    if (!latestForBubble) {
      latestForBubble = traceEntries[traceEntries.length - 1];
    }
    const bubbleSummary = latestForBubble?.summary || latestForBubble?.text || '';
    if (bubbleSummary) {
      agent.bubbleSpeech = shortText(bubbleSummary, 70);
    }
  }

  function buildSequentialHandoffMessage(initialMessage, previousAgentResponse) {
    if (state.handoffMode === 'append_history') {
      return `${initialMessage}\n\nPrevious agent response: ${previousAgentResponse}`;
    }
    return `Previous agent response: ${previousAgentResponse}`;
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

      function badges(label, items, cls) {
        if (!items || !items.length) return '';
        return items.map((t) => `<span class="badge ${cls}">${label}: ${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join(' ');
      }

      const badgeHtml = [
        badges('🔧', agent.tools, 'badge-tool'),
        badges('📚', agent.knowledge, 'badge-knowledge'),
        badges('🧠', agent.memory, 'badge-memory'),
        agent.guardrail ? `<span class="badge badge-guardrail">🛡️ ${agent.guardrail.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>` : ''
      ].filter(Boolean).join(' ');

      card.innerHTML = `
        <div class="agent-name">${escapedName}</div>
        <div class="status">${agent.enabled ? 'Online at desk' : 'Sleeping at desk'}</div>
        ${badgeHtml ? '<div class="agent-badges">' + badgeHtml + '</div>' : ''}
        <label>
          <input type="checkbox" ${agent.enabled ? 'checked' : ''} data-agent-toggle="${agent.id}" />
          Enabled
        </label>
        <div class="agent-chat">
          <div class="agent-last-speech" data-agent-speech="${agent.id}">${escapedSpeech ? '💬 ' + escapedSpeech : ''}</div>
          <div class="row agent-chat-row">
            <input data-agent-input="${agent.id}" placeholder="Say something to ${escapedName}..." />
            <button data-agent-send="${agent.id}">Chat</button>
          </div>
        </div>
      `;
      ids.agentList.appendChild(card);
    });
  }

  function createDeskElement({ x, y }, label, spriteClass, bubbleText, agentId) {
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
      if (agentId) bubble.dataset.agentBubble = agentId;
      desk.appendChild(bubble);
    }

    return desk;
  }

  function renderOffice() {
    ids.office.innerHTML = '';

    const scene = document.createElement('div');
    scene.className = 'iso-scene';

    // Person image layers (1.png through 6.png)
    state.agents.forEach((agent, index) => {
      if (index >= 6) return;
      const img = document.createElement('img');
      img.src = `assets/img/${index + 1}.png`;
      img.className = 'person-layer' + (agent.enabled ? '' : ' hidden');
      img.alt = agent.name;
      scene.appendChild(img);
    });

    // Desks (overlay labels + bubbles on background image)
    const userDesk = DESKS[state.user.deskIndex];
    scene.appendChild(createDeskElement(userDesk, state.user.name, 'user', state.user.speech));

    state.agents.forEach((agent, index) => {
      const desk = getDeskForAgent(index);
      const spriteClass = agent.enabled ? 'awake' : 'nap';
      const bubble = agent.enabled ? (agent.bubbleSpeech || agent.lastSpeech) : 'Zzz...';
      scene.appendChild(createDeskElement(desk, agent.name, spriteClass, bubble, agent.id));
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
        lastSpeech: 'Ready to help!',
        bubbleSpeech: ''
      });
      ids.npcName.value = '';
      ids.npcDescription.value = '';
      renderAgentsPanel();
      renderOffice();
      setLog(`Created NPC "${name}" (Foundry ID: ${foundryAgent.id}).`);
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
      const stopFns = enabledAgents.map((agent) => startThinking(agent.id));
      const results = await Promise.allSettled(enabledAgents.map(async (agent, i) => {
        addTrace({
          agentName: agent.name,
          agentId: agent.id,
          type: 'workflow_dispatch',
          summary: `Group dispatch: "${shortText(message)}"`
        });
        try {
          const result = await sendMessageToFoundryAgent(agent, message);
          stopFns[i]();
          const response = result?.response || 'No response received from agent.';
          agent.lastSpeech = response;
          addTraceEntries(agent, result, 'group');
          renderOffice();
          renderAgentsPanel();
        } catch (error) {
          stopFns[i]();
          throw new Error(`Agent ${agent.name} failed in group workflow: ${error.message}`);
        }
      }));

      stopFns.forEach((fn) => fn());

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
      const stopThinking = startThinking(agent.id);
      addTrace({
        agentName: agent.name,
        agentId: agent.id,
        type: 'handoff_in',
        summary: `Sequential handoff (${state.handoffMode}): "${shortText(rollingMessage)}"`
      });
      try {
        const result = await sendMessageToFoundryAgent(agent, rollingMessage);
        stopThinking();
        const response = result?.response || 'No response received from agent.';
        agent.lastSpeech = response;
        addTraceEntries(agent, result, 'sequential');
        rollingMessage = buildSequentialHandoffMessage(message, response);
        renderOffice();
        renderAgentsPanel();
      } catch (error) {
        stopThinking();
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
    addTrace({
      agentName: state.user.name,
      agentId: 'user',
      type: 'user_message',
      summary: message
    });

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

  async function loadAgents() {
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
        tools: ra.tools || [],
        knowledge: ra.knowledge || [],
        memory: ra.memory || [],
        guardrail: ra.guardrail || '',
        enabled: true,
        lastSpeech: 'Ready to help!',
        bubbleSpeech: ''
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
  }

  ids.loadAgentsBtn.addEventListener('click', loadAgents);
  ids.workflowMode.addEventListener('change', () => {
    state.workflowMode = ids.workflowMode.value;
    setLog(`Workflow set to ${state.workflowMode}.`);
  });
  ids.handoffMode.addEventListener('change', () => {
    state.handoffMode = ids.handoffMode.value;
    setLog(`Sequential handoff set to ${state.handoffMode}.`);
  });

  ids.clearTraceBtn.addEventListener('click', () => {
    state.trace = [];
    renderTracePanel();
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
  renderTracePanel();
  loadAgents();
})();

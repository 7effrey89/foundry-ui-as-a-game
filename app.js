(() => {
  const state = {
    user: {
      name: 'You',
      speech: 'Hello office!',
      deskIndex: 0
    },
    workflowMode: 'concurrent',
    handoffMode: 'previous_response',
    maxRounds: 3,
    triageAgentId: '',
    managerAgentId: '',
    trace: [],
    agents: []
  };

  const API_BASE = '/api';

  // Desk positions as fractions of the 1024×1024 source image (head positions)
  // Agent i → desk (i+1)%6, person overlay (i+1).png
  const DESK_IMG = [
    { ix: 0.68, iy: 0.56 },  // desk 0: person 6.png head (front-right)
    { ix: 0.30, iy: 0.29 },  // desk 1: person 1.png head (back-left)
    { ix: 0.49, iy: 0.27 },  // desk 2: person 2.png head (back-center)
    { ix: 0.26, iy: 0.54 },  // desk 3: person 3.png head (front-left)
    { ix: 0.48, iy: 0.41 },  // desk 4: person 4.png head (center)
    { ix: 0.80, iy: 0.33 }   // desk 5: person 5.png head (back-right)
  ];

  function getDesks() {
    return DESK_IMG.map(({ ix, iy }) => ({
      pctX: (ix * 100 - 5).toFixed(2),
      pctY: (iy * 100 - 3).toFixed(2)
    }));
  }

  const THINKING_PHRASES = [
    'Thinking...', 'Looking at tools...',
    'Searching knowledge base...', 'Processing...',
    'Reading documents...', 'Analyzing...',
    'Consulting sources...', 'Hmm...',
    'Let me check...', 'One moment...'
  ];

  const DOT_SEQUENCE = ['.', '..', '...'];
  const MAX_ENABLED_AGENTS = 6;
  const MAX_TRACE_ENTRIES = 300;

  const AGENT_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4'
  ];

  function getAgentColor(agentId) {
    const idx = state.agents.findIndex((a) => a.id === agentId);
    if (idx < 0) return '#6b7280';
    return AGENT_COLORS[idx % AGENT_COLORS.length];
  }

  const ORCHESTRATION_INFO = {
    concurrent: {
      name: 'Concurrent',
      summary: 'All agents process the same message simultaneously and independently. Results are collected from every agent.',
      pattern: 'Fan-out \u2192 [Agent A | Agent B | Agent C] \u2192 Collect results',
      useCase: 'Brainstorming, diverse perspectives, ensemble reasoning, voting',
      docUrl: 'https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/concurrent'
    },
    sequential: {
      name: 'Sequential',
      summary: 'Agents execute one after another in a pipeline. Each agent builds on the previous agent\u2019s output.',
      pattern: 'Pipeline \u2192 Agent A \u2192 Agent B \u2192 Agent C \u2192 Final',
      useCase: 'Document review, data processing pipelines, multi-stage reasoning',
      docUrl: 'https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/sequential'
    },
    handoff: {
      name: 'Handoff',
      summary: 'A triage agent routes conversations to specialist agents based on context. Agents transfer control to each other dynamically.',
      pattern: 'Mesh \u2192 Triage \u21c4 Specialist A \u21c4 Specialist B',
      useCase: 'Customer support, expert systems, dynamic delegation',
      docUrl: 'https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff'
    },
    group_chat: {
      name: 'Group Chat',
      summary: 'Agents take turns in a shared conversation (round-robin). Each sees the full history and can refine prior work.',
      pattern: 'Star \u2192 [A \u2192 B \u2192 A \u2192 B \u2026] (N rounds)',
      useCase: 'Iterative refinement, collaborative problem-solving, writer-reviewer workflows',
      docUrl: 'https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat'
    },
    magentic: {
      name: 'Magentic',
      summary: 'A manager agent dynamically plans and delegates tasks to specialized worker agents, coordinating the overall workflow.',
      pattern: 'Hub \u2192 Manager \u21c4 Worker A, Manager \u21c4 Worker B',
      useCase: 'Complex planning, research tasks, multi-step problem solving',
      docUrl: 'https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic'
    }
  };

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
    clearTraceBtn: document.getElementById('clearTraceBtn'),
    orchestrationInfo: document.getElementById('orchestrationInfo'),
    sequentialConfig: document.getElementById('sequentialConfig'),
    handoffConfig: document.getElementById('handoffConfig'),
    groupChatConfig: document.getElementById('groupChatConfig'),
    magenticConfig: document.getElementById('magenticConfig'),
    triageAgent: document.getElementById('triageAgent'),
    managerAgent: document.getElementById('managerAgent'),
    maxRoundsInput: document.getElementById('maxRounds')
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

  async function sendMessageToFoundryAgent(agent, message, context) {
    const body = { agentName: agent.foundryAgentName, message };
    if (context && context.length) { body.context = context; }
    return foundryRequest('/messages', 'POST', body);
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
    const desks = getDesks();
    return desks[(index + 1) % desks.length];
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
      const color = entry.agentId === 'user' ? '#6b7280' : getAgentColor(entry.agentId);
      item.style.borderLeftColor = color;

      const meta = document.createElement('div');
      meta.className = 'trace-meta';
      const dot = `<span class="trace-dot" style="background:${color}"></span>`;
      meta.innerHTML = `${dot}${entry.time} \u2022 ${entry.agentName.replace(/&/g, '&amp;').replace(/</g, '&lt;')} \u2022 ${entry.type}`;

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
    if (state.trace.length > MAX_TRACE_ENTRIES) {
      state.trace = state.trace.slice(state.trace.length - MAX_TRACE_ENTRIES);
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
    const bubbleSummary = latestForBubble?.text || latestForBubble?.summary || '';
    if (bubbleSummary) {
      agent.bubbleSpeech = shortText(bubbleSummary, 70);
    }
  }

  function buildSequentialHandoffMessage(originalUserMessage, previousAgentResponse) {
    if (state.handoffMode === 'append_history') {
      return `${originalUserMessage}\n\nPrevious agent response: ${previousAgentResponse}`;
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
      const agentColor = getAgentColor(agent.id);
      card.style.borderLeftColor = agentColor;

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
        <div class="agent-name"><span class="agent-color-dot" style="background:${agentColor}"></span>${escapedName}</div>
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

  function createDeskElement(pos, label, spriteClass, bubbleText, agentId, agentColor) {
    const desk = document.createElement('div');
    desk.className = 'iso-desk';
    if (spriteClass === 'empty') desk.classList.add('empty-desk');
    desk.style.left = `${pos.pctX}%`;
    desk.style.top = `${pos.pctY}%`;

    const nameRow = document.createElement('div');
    nameRow.className = 'iso-label';

    const dot = document.createElement('span');
    dot.className = `desk-status ${spriteClass}`;
    if (agentColor) dot.style.background = agentColor;
    nameRow.appendChild(dot);

    const text = document.createElement('span');
    text.textContent = label;
    nameRow.appendChild(text);

    desk.appendChild(nameRow);

    if (bubbleText) {
      const bubble = document.createElement('div');
      bubble.className = 'px-bubble';
      bubble.textContent = bubbleText;
      if (agentId) bubble.dataset.agentBubble = agentId;
      desk.appendChild(bubble);
    }

    return desk;
  }

  function showSeatAssignDropdown(deskEl, slotIndex) {
    // Remove any existing dropdown
    const existing = document.querySelector('.seat-assign-dropdown');
    if (existing) existing.remove();

    const disabledAgents = state.agents.filter((a) => !a.enabled);
    if (!disabledAgents.length) {
      const dd = document.createElement('div');
      dd.className = 'seat-assign-dropdown';
      const item = document.createElement('div');
      item.className = 'seat-option no-agents';
      item.textContent = 'No available agents';
      dd.appendChild(item);
      deskEl.appendChild(dd);
      setTimeout(() => dd.remove(), 2000);
      return;
    }

    const dd = document.createElement('div');
    dd.className = 'seat-assign-dropdown';

    disabledAgents.forEach((agent) => {
      const item = document.createElement('div');
      item.className = 'seat-option';
      const color = getAgentColor(agent.id);
      item.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px;vertical-align:middle"></span>${agent.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const enabledCount = state.agents.filter((a) => a.enabled).length;
        if (enabledCount >= MAX_ENABLED_AGENTS) {
          setLog(`Max ${MAX_ENABLED_AGENTS} agents can be online at once.`);
          dd.remove();
          return;
        }
        agent.enabled = true;
        dd.remove();
        renderAgentsPanel();
        renderOffice();
        populateAgentSelectors();
        setLog(`${agent.name} assigned to desk and is now online.`);
      });
      dd.appendChild(item);
    });

    deskEl.appendChild(dd);

    // Close on click outside
    const closeHandler = (e) => {
      if (!dd.contains(e.target) && !deskEl.contains(e.target)) {
        dd.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  function renderOffice() {
    ids.office.innerHTML = '';

    const scene = document.createElement('div');
    scene.className = 'iso-scene';

    // Only enabled agents get desks and person overlays (max 5)
    const enabledAgents = state.agents.filter((a) => a.enabled).slice(0, MAX_ENABLED_AGENTS);
    const desks = getDesks();

    // Person image layers (1.png through 6.png) — assigned dynamically to enabled agents
    enabledAgents.forEach((agent, slot) => {
      const img = document.createElement('img');
      img.src = `assets/img/${slot + 1}.png`;
      img.className = 'person-layer';
      img.alt = agent.name;
      scene.appendChild(img);
    });

    // Desks (overlay labels + bubbles)
    const usedDesks = new Set();
    enabledAgents.forEach((agent, slot) => {
      const deskIdx = (slot + 1) % desks.length;
      usedDesks.add(deskIdx);
      const desk = desks[deskIdx];
      const bubble = agent.bubbleSpeech || agent.lastSpeech || '';
      const color = getAgentColor(agent.id);
      scene.appendChild(createDeskElement(desk, agent.name, 'awake', bubble, agent.id, color));
    });

    // Fill remaining desks as empty (clickable to assign)
    for (let i = 0; i < desks.length; i += 1) {
      if (usedDesks.has(i)) continue;
      const emptyDesk = createDeskElement(desks[i], 'Empty Seat', 'empty');
      const slotIndex = i;
      emptyDesk.addEventListener('click', () => showSeatAssignDropdown(emptyDesk, slotIndex));
      scene.appendChild(emptyDesk);
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

  async function runConcurrent(message, enabledAgents) {
    const stopFns = enabledAgents.map((agent) => startThinking(agent.id));
    const results = await Promise.allSettled(enabledAgents.map(async (agent, i) => {
      addTrace({
        agentName: agent.name,
        agentId: agent.id,
        type: 'concurrent_dispatch',
        summary: `Concurrent dispatch: "${shortText(message)}"`
      });
      try {
        const result = await sendMessageToFoundryAgent(agent, message);
        stopFns[i]();
        const response = result?.response || 'No response received from agent.';
        agent.lastSpeech = response;
        addTraceEntries(agent, result, 'concurrent');
        renderOffice();
        renderAgentsPanel();
      } catch (error) {
        stopFns[i]();
        throw new Error(`Agent ${agent.name} failed: ${error.message}`);
      }
    }));
    stopFns.forEach((fn) => fn());
    const failures = results
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason.message);
    if (failures.length) throw new Error(failures.join(' | '));
  }

  async function runSequential(message, enabledAgents) {
    let rollingMessage = message;
    for (const agent of enabledAgents) {
      const stopThinking = startThinking(agent.id);
      addTrace({
        agentName: agent.name,
        agentId: agent.id,
        type: 'sequential_step',
        summary: `Sequential step (${state.handoffMode}): "${shortText(rollingMessage)}"`
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
        throw new Error(`Agent ${agent.name} failed: ${error.message}`);
      }
    }
  }

  async function runHandoff(message, enabledAgents) {
    const triageAgent = enabledAgents.find((a) => a.id === state.triageAgentId) || enabledAgents[0];
    const otherAgents = enabledAgents.filter((a) => a.id !== triageAgent.id);
    const agentDirectory = otherAgents.map((a) => a.name).join(', ');
    const MAX_HANDOFFS = 5;
    let currentAgent = triageAgent;
    let currentMessage = message;
    if (otherAgents.length) {
      currentMessage += '\n\n[You are part of a handoff workflow. Available specialist agents: ' + agentDirectory +
        '. If this question needs a specialist, end your response with [HANDOFF:agent_name]. Otherwise respond normally.]';
    }
    const context = [];
    for (let hop = 0; hop < MAX_HANDOFFS; hop++) {
      const stopThinking = startThinking(currentAgent.id);
      addTrace({
        agentName: currentAgent.name,
        agentId: currentAgent.id,
        type: 'handoff_receive',
        summary: `Handoff step ${hop + 1}: ${currentAgent.name} processing`
      });
      try {
        const result = await sendMessageToFoundryAgent(currentAgent, currentMessage, context);
        stopThinking();
        const response = result?.response || 'No response received from agent.';
        currentAgent.lastSpeech = response;
        addTraceEntries(currentAgent, result, 'handoff');
        renderOffice();
        renderAgentsPanel();
        const handoffMatch = response.match(/\[HANDOFF:([^\]]+)\]/i);
        if (handoffMatch) {
          const targetName = handoffMatch[1].trim();
          const targetAgent = enabledAgents.find((a) =>
            a.name.toLowerCase() === targetName.toLowerCase() ||
            (a.foundryAgentName || '').toLowerCase() === targetName.toLowerCase()
          );
          if (targetAgent && targetAgent.id !== currentAgent.id) {
            addTrace({
              agentName: currentAgent.name,
              agentId: currentAgent.id,
              type: 'handoff_transfer',
              summary: `${currentAgent.name} \u2192 ${targetAgent.name}`
            });
            context.push({ role: 'assistant', content: response });
            const remaining = enabledAgents.filter((a) => a.id !== targetAgent.id).map((a) => a.name).join(', ');
            currentMessage = message + '\n\n[You received a handoff. Prior agent said: ' +
              response.replace(/\[HANDOFF:[^\]]+\]/gi, '').trim() +
              (remaining ? '\nAvailable agents for further handoff: ' + remaining + '. End with [HANDOFF:agent_name] to transfer, or respond normally.]' : ']');
            currentAgent = targetAgent;
            continue;
          }
        }
        break;
      } catch (error) {
        stopThinking();
        throw new Error(`Agent ${currentAgent.name} failed: ${error.message}`);
      }
    }
  }

  async function runGroupChat(message, enabledAgents) {
    const maxRounds = state.maxRounds || 3;
    const conversation = [];
    let roundMessage = message;
    for (let round = 0; round < maxRounds; round++) {
      for (const agent of enabledAgents) {
        const stopThinking = startThinking(agent.id);
        addTrace({
          agentName: agent.name,
          agentId: agent.id,
          type: 'group_chat_turn',
          summary: `Round ${round + 1}: ${agent.name}'s turn`
        });
        try {
          const result = await sendMessageToFoundryAgent(agent, roundMessage, conversation);
          stopThinking();
          const response = result?.response || 'No response received from agent.';
          agent.lastSpeech = response;
          addTraceEntries(agent, result, 'group_chat');
          conversation.push({ role: 'assistant', content: '[' + agent.name + ']: ' + response });
          roundMessage = 'Continue the group discussion. Original task: ' + message;
          renderOffice();
          renderAgentsPanel();
        } catch (error) {
          stopThinking();
          throw new Error(`Agent ${agent.name} failed: ${error.message}`);
        }
      }
    }
  }

  async function runMagentic(message, enabledAgents) {
    const managerAgent = enabledAgents.find((a) => a.id === state.managerAgentId) || enabledAgents[0];
    const workerAgents = enabledAgents.filter((a) => a.id !== managerAgent.id);
    const workerNames = workerAgents.map((a) => a.name).join(', ');
    const MAX_ITERATIONS = 5;
    const context = [];
    if (!workerAgents.length) {
      const stopThinking = startThinking(managerAgent.id);
      addTrace({ agentName: managerAgent.name, agentId: managerAgent.id, type: 'magentic_solo', summary: 'Only one agent \u2014 running directly' });
      try {
        const result = await sendMessageToFoundryAgent(managerAgent, message);
        stopThinking();
        managerAgent.lastSpeech = result?.response || 'No response received from agent.';
        addTraceEntries(managerAgent, result, 'magentic');
        renderOffice();
        renderAgentsPanel();
      } catch (error) {
        stopThinking();
        throw new Error(`Agent ${managerAgent.name} failed: ${error.message}`);
      }
      return;
    }
    let managerMessage = message + '\n\n[You are a manager agent. Your workers: ' + workerNames +
      '. Delegate by responding with [DELEGATE:agent_name:task description]. When finished, respond with [DONE] followed by the final answer.]';
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stopThinking = startThinking(managerAgent.id);
      addTrace({
        agentName: managerAgent.name,
        agentId: managerAgent.id,
        type: 'magentic_plan',
        summary: `Manager planning (iteration ${i + 1})`
      });
      try {
        const result = await sendMessageToFoundryAgent(managerAgent, managerMessage, context);
        stopThinking();
        const response = result?.response || 'No response received from agent.';
        managerAgent.lastSpeech = response;
        addTraceEntries(managerAgent, result, 'magentic');
        renderOffice();
        renderAgentsPanel();
        if (response.includes('[DONE]')) {
          addTrace({ agentName: managerAgent.name, agentId: managerAgent.id, type: 'magentic_done', summary: 'Manager declared workflow complete' });
          managerAgent.lastSpeech = response.replace(/\[DONE\]/gi, '').trim();
          renderOffice();
          renderAgentsPanel();
          break;
        }
        const delegateMatch = response.match(/\[DELEGATE:([^:]+):([^\]]+)\]/i);
        if (delegateMatch) {
          const workerName = delegateMatch[1].trim();
          const task = delegateMatch[2].trim();
          const worker = workerAgents.find((a) =>
            a.name.toLowerCase() === workerName.toLowerCase() ||
            (a.foundryAgentName || '').toLowerCase() === workerName.toLowerCase()
          );
          if (worker) {
            addTrace({ agentName: managerAgent.name, agentId: managerAgent.id, type: 'magentic_delegate', summary: `Manager \u2192 ${worker.name}: "${shortText(task)}"` });
            const workerStop = startThinking(worker.id);
            try {
              const workerResult = await sendMessageToFoundryAgent(worker, task);
              workerStop();
              const workerResponse = workerResult?.response || 'No response received from agent.';
              worker.lastSpeech = workerResponse;
              addTraceEntries(worker, workerResult, 'magentic');
              renderOffice();
              renderAgentsPanel();
              context.push({ role: 'assistant', content: response });
              context.push({ role: 'user', content: 'Worker ' + worker.name + ' completed the task: ' + workerResponse });
              managerMessage = 'Worker ' + worker.name + ' responded: "' + workerResponse +
                '"\n\n[Continue coordinating. Workers: ' + workerNames + '. Use [DELEGATE:name:task] or [DONE] followed by the final answer.]';
            } catch (error) {
              workerStop();
              throw new Error(`Worker ${worker.name} failed: ${error.message}`);
            }
          } else {
            context.push({ role: 'assistant', content: response });
            managerMessage = 'Worker "' + workerName + '" not found. Available: ' + workerNames + '. Use [DELEGATE:name:task] or [DONE].';
          }
        } else {
          break;
        }
      } catch (error) {
        stopThinking();
        throw new Error(`Manager ${managerAgent.name} failed: ${error.message}`);
      }
    }
  }

  async function processMessageThroughWorkflow(message) {
    const enabledAgents = state.agents.filter((a) => a.enabled);
    if (!enabledAgents.length) {
      setLog('No enabled agents are online.');
      return;
    }
    switch (state.workflowMode) {
      case 'sequential':
        await runSequential(message, enabledAgents);
        break;
      case 'handoff':
        await runHandoff(message, enabledAgents);
        break;
      case 'group_chat':
        await runGroupChat(message, enabledAgents);
        break;
      case 'magentic':
        await runMagentic(message, enabledAgents);
        break;
      default:
        await runConcurrent(message, enabledAgents);
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

  function renderOrchestrationInfo() {
    const mode = state.workflowMode;
    const info = ORCHESTRATION_INFO[mode] || ORCHESTRATION_INFO.concurrent;
    if (ids.orchestrationInfo) {
      ids.orchestrationInfo.innerHTML =
        '<div class="info-label">' + info.name + '</div>' +
        '<div>' + info.summary + '</div>' +
        '<div class="info-pattern">' + info.pattern + '</div>' +
        '<div class="info-use-case">Use cases: ' + info.useCase + '</div>' +
        '<a href="' + info.docUrl + '" target="_blank" rel="noopener">Documentation \u2197</a>';
    }
    const configs = ['sequentialConfig', 'handoffConfig', 'groupChatConfig', 'magenticConfig'];
    configs.forEach((id) => { if (ids[id]) ids[id].style.display = 'none'; });
    const configMap = { sequential: 'sequentialConfig', handoff: 'handoffConfig', group_chat: 'groupChatConfig', magentic: 'magenticConfig' };
    const active = configMap[mode];
    if (active && ids[active]) ids[active].style.display = '';
  }

  function populateAgentSelectors() {
    const enabledAgents = state.agents.filter((a) => a.enabled);
    [ids.triageAgent, ids.managerAgent].forEach((select) => {
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">First enabled agent</option>';
      enabledAgents.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        select.appendChild(opt);
      });
      if (current) select.value = current;
    });
  }

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
            enabled: state.agents.filter((a) => a.enabled).length + added < MAX_ENABLED_AGENTS,
            lastSpeech: 'Ready to help!',
            bubbleSpeech: ''
          });
          added += 1;
        }
      });
      renderAgentsPanel();
      renderOffice();
      populateAgentSelectors();
      setLog(`Loaded ${added} new agent(s) from Foundry (${remoteAgents.length} total).`);
    } catch (error) {
      setLog(error.message);
    }
  }

  ids.loadAgentsBtn.addEventListener('click', loadAgents);
  ids.workflowMode.addEventListener('change', () => {
    state.workflowMode = ids.workflowMode.value;
    renderOrchestrationInfo();
    populateAgentSelectors();
    setLog(`Orchestration set to ${ORCHESTRATION_INFO[state.workflowMode]?.name || state.workflowMode}.`);
  });
  ids.handoffMode.addEventListener('change', () => {
    state.handoffMode = ids.handoffMode.value;
  });
  if (ids.triageAgent) {
    ids.triageAgent.addEventListener('change', () => {
      state.triageAgentId = ids.triageAgent.value;
    });
  }
  if (ids.managerAgent) {
    ids.managerAgent.addEventListener('change', () => {
      state.managerAgentId = ids.managerAgent.value;
    });
  }
  if (ids.maxRoundsInput) {
    ids.maxRoundsInput.addEventListener('change', () => {
      state.maxRounds = parseInt(ids.maxRoundsInput.value, 10) || 3;
    });
  }

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

    if (target.checked) {
      const enabledCount = state.agents.filter((a) => a.enabled).length;
      if (enabledCount >= MAX_ENABLED_AGENTS) {
        target.checked = false;
        setLog(`Max ${MAX_ENABLED_AGENTS} agents can be online at once.`);
        return;
      }
    }
    agent.enabled = target.checked;
    renderAgentsPanel();
    renderOffice();
    populateAgentSelectors();
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
  renderOrchestrationInfo();
  populateAgentSelectors();
  loadAgents();
})();

// Voice module — Gemini Live WebSocket client (browser-direct, no SDK)
// States: idle → connecting → listening → processing → speaking → idle

(function() {
  const GEMINI_MODEL = 'gemini-3.1-flash-live-preview';
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
  const MIC_SAMPLE_RATE = 16000;
  const SPEAKER_SAMPLE_RATE = 24000;

  const TOOL_DECLARATIONS = [
    {
      name: 'search_people',
      description: 'Search for people by name, role, or email. Returns up to 10 matches.',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Search query' } }, required: ['query'] }
    },
    {
      name: 'get_person_full',
      description: 'Get full profile and all connections for a person.',
      parameters: { type: 'OBJECT', properties: { person_id: { type: 'STRING', description: 'Person ID, e.g. person-008' } }, required: ['person_id'] }
    },
    {
      name: 'get_team_full',
      description: 'Get team details: members, manager, projects.',
      parameters: { type: 'OBJECT', properties: { team_id: { type: 'STRING', description: 'Team ID' } }, required: ['team_id'] }
    },
    {
      name: 'get_direct_reports',
      description: 'Get direct reports for a manager. Optionally recursive.',
      parameters: {
        type: 'OBJECT',
        properties: {
          person_id: { type: 'STRING', description: 'Manager person ID' },
          recursive: { type: 'BOOLEAN', description: 'Recurse down the tree' }
        },
        required: ['person_id']
      }
    },
    {
      name: 'search_nodes',
      description: 'Search any node type by name, title, role, or description.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Search query' },
          node_type: { type: 'STRING', description: 'Optional: filter by node type' }
        },
        required: ['query']
      }
    },
    {
      name: 'get_impact_radius',
      description: 'Multi-hop impact analysis for a person: reports, mentees, projects, skills, teams.',
      parameters: { type: 'OBJECT', properties: { person_id: { type: 'STRING', description: 'Person ID to analyze' } }, required: ['person_id'] }
    },
    {
      name: 'get_graph_schema',
      description: 'Returns the schema of the employee graph: all node types, edge types, properties, and counts.',
      parameters: { type: 'OBJECT', properties: {} }
    }
  ];

  const CARD_HTML_INSTRUCTIONS = `HTML rules for cards:
- Use CSS classes: stat-block (container), stat-label (label text), stat-value (large number). Wrap multiple stats in a flex row with gap:8px.
- Use section-block class for grouped content sections.
- For people, ALWAYS use avatar lockup: <div style="display:flex;align-items:center;gap:10px"><img src="https://mattcmorrell.github.io/ee-graph/data/avatars/{person-id}.jpg" style="width:36px;height:36px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'" /><div><div style="font-size:14px;font-weight:600">{Name}</div><div style="font-size:12px;color:#999">{Role}</div></div></div>
- For severity badges: use classes pill-error-muted, pill-warning-muted, pill-success-muted, pill-info-muted.
- Keep each card body to 3-5 data points max. Cards are 320px wide.
- Min font: 13px body, 11px labels. No background gradients. No colored left borders.`;

  const CARD_TOOL_BATCH = {
    name: 'show_cards',
    description: `Display 2-4 analysis cards on the canvas. Each card covers ONE focused aspect. For follow-up cards, set parentId to the ID of the card they should branch from (e.g. if exploring "Team Impact" deeper, set parentId to that card's ID). Omit parentId for top-level cards. ${CARD_HTML_INSTRUCTIONS}`,
    parameters: {
      type: 'OBJECT',
      properties: {
        cards: {
          type: 'ARRAY',
          description: 'Array of 2-4 cards',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Unique card ID like card-mgr-gap' },
              title: { type: 'STRING', description: 'Short title, 2-4 words' },
              html: { type: 'STRING', description: 'Card body HTML' },
              parentId: { type: 'STRING', description: 'ID of parent card to branch from. Use IDs from previous show_cards calls. Omit for top-level.' },
              prompts: {
                type: 'ARRAY',
                description: 'Optional follow-up prompts for this card',
                items: {
                  type: 'OBJECT',
                  properties: {
                    text: { type: 'STRING' },
                    featured: { type: 'BOOLEAN' }
                  },
                  required: ['text']
                }
              }
            },
            required: ['id', 'title', 'html']
          }
        }
      },
      required: ['cards']
    }
  };

  const CARD_TOOL_COMPARISON = {
    name: 'show_comparison',
    description: 'Show 2-4 people side by side for comparison. Use when comparing candidates for a role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        options: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              personId: { type: 'STRING', description: 'Graph person ID for avatar' },
              name: { type: 'STRING' },
              role: { type: 'STRING' },
              metrics: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    label: { type: 'STRING' },
                    value: { type: 'STRING' },
                    sentiment: { type: 'STRING', description: 'positive, warning, or negative' }
                  },
                  required: ['label', 'value']
                }
              },
              strengths: { type: 'ARRAY', items: { type: 'STRING' } },
              risks: { type: 'ARRAY', items: { type: 'STRING' } },
              summary: { type: 'STRING' },
              tag: { type: 'STRING' }
            },
            required: ['id', 'name', 'role']
          }
        }
      },
      required: ['options']
    }
  };

  const CARD_TOOL_ROOT = {
    name: 'set_root',
    description: 'Set the root node on the canvas. Call this FIRST before show_cards/show_card. For a person scenario, provide entity. For a general topic, provide topic.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entity: {
          type: 'OBJECT',
          description: 'Person entity for person-centric scenarios',
          properties: {
            id: { type: 'STRING', description: 'Graph person ID e.g. person-008' },
            name: { type: 'STRING' },
            role: { type: 'STRING' },
            badge: { type: 'STRING', description: 'Status like Resigned, On Leave. Omit for active.' },
            badgeType: { type: 'STRING', description: 'critical, warning, or info' }
          },
          required: ['id', 'name', 'role']
        },
        topic: {
          type: 'OBJECT',
          description: 'Topic for general questions',
          properties: {
            title: { type: 'STRING' },
            subtitle: { type: 'STRING' }
          },
          required: ['title']
        }
      }
    }
  };

  class VoiceManager {
    constructor(opts = {}) {
      this.state = 'idle';
      this.canvasEnabled = opts.canvasEnabled || false;
      this.onStateChange = opts.onStateChange || (() => {});
      this.onInputTranscript = opts.onInputTranscript || (() => {});
      this.onOutputTranscript = opts.onOutputTranscript || (() => {});
      this.onCanvasCard = opts.onCanvasCard || (() => {});
      this.onToolCall = opts.onToolCall || (() => {});
      this.onError = opts.onError || (() => {});

      this._ws = null;
      this._audioCtx = null;
      this._micStream = null;
      this._micNode = null;
      this._workletNode = null;
      this._playbackQueue = [];
      this._isPlaying = false;
      this._inputText = '';
      this._outputText = '';
      this._setupDone = false;
    }

    _setState(s) {
      console.log(`[Voice] ${this.state} → ${s}`);
      this.state = s;
      this.onStateChange(s);
    }

    // --- Public API ---

    async start() {
      if (this.state !== 'idle') return;
      this._setState('connecting');
      try {
        console.log('[Voice] Requesting ephemeral token...');
        const token = await this._getToken();
        console.log('[Voice] Token received, connecting WebSocket...');
        await this._connectWebSocket(token);
        console.log('[Voice] WebSocket connected, starting mic...');
        await this._startMic();
        console.log('[Voice] Mic started, playing ready sound...');
        this._playReadySound();
        this._setState('listening');
      } catch (e) {
        console.error('[Voice] Start failed:', e);
        this.onError(e.message || 'Failed to start voice');
        this.stop();
      }
    }

    stop() {
      this._stopMic();
      this._closeWebSocket();
      this._stopPlayback();
      this._inputText = '';
      this._outputText = '';
      this._setupDone = false;
      this._setState('idle');
    }

    interrupt() {
      this._stopPlayback();
      if (this.state === 'speaking') {
        this._setState('listening');
      }
    }

    // --- Ready sound (short rising tone) ---

    _playReadySound() {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
        setTimeout(() => ctx.close(), 300);
      } catch (e) {
        // Audio not critical
      }
    }

    // --- Token ---

    async _getToken() {
      const res = await fetch('/api/gemini-token');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Token request failed');
      }
      const data = await res.json();
      return data.token;
    }

    // --- WebSocket ---

    _connectWebSocket(token) {
      return new Promise((resolve, reject) => {
        const url = `${WS_URL}?access_token=${encodeURIComponent(token)}`;
        this._ws = new WebSocket(url);

        this._ws.onopen = () => {
          this._sendSetup();
          resolve();
        };

        this._ws.onmessage = async (event) => {
          try {
            let text;
            if (typeof event.data === 'string') {
              text = event.data;
            } else if (event.data instanceof Blob) {
              text = await event.data.text();
            } else if (event.data instanceof ArrayBuffer) {
              text = new TextDecoder().decode(event.data);
            } else {
              return;
            }
            const msg = JSON.parse(text);
            this._handleMessage(msg);
          } catch (e) {
            console.error('[Voice] WS parse error:', e);
          }
        };

        this._ws.onerror = (e) => {
          console.error('WS error:', e);
          reject(new Error('WebSocket connection failed'));
        };

        this._ws.onclose = (e) => {
          if (this.state !== 'idle') {
            console.log('WS closed:', e.code, e.reason);
            this.stop();
          }
        };
      });
    }

    _sendSetup() {
      const allTools = [...TOOL_DECLARATIONS];
      let canvasInstructions = '';

      if (this.canvasEnabled) {
        allTools.push(CARD_TOOL_BATCH, CARD_TOOL_COMPARISON, CARD_TOOL_ROOT);
        canvasInstructions = `

IMPORTANT — Canvas tools:
You have canvas tools that display visual cards on the big screen behind you. You MUST call these for every substantive question:
1. First call set_root to establish the person or topic (only needed once per scenario).
2. Then call show_cards with 2-4 focused analysis cards using real graph data.
3. Speak a brief 1-2 sentence summary — the cards do the heavy lifting.
For candidate comparisons, use show_comparison instead.

CRITICAL — Card tree structure:
Cards form a TREE on the canvas. The first show_cards call creates top-level cards (no parentId needed). For follow-up questions, set parentId on each card to the ID of the card it drills into. For example, if the first call created cards with IDs "card-team-impact" and "card-skill-gaps", and the user asks about team impact, the follow-up cards should have parentId: "card-team-impact". The tool response tells you which card IDs were rendered — use them.`;
      }

      const setup = {
        setup: {
          model: `models/${GEMINI_MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Leda' }
              }
            }
          },
          systemInstruction: {
            parts: [{
              text: `You are a knowledgeable HR analytics assistant at Acme Co, a 148-employee tech company in Austin, TX. You help visitors explore employee scenarios using the company's Employee Experience Graph.

You have access to tools that query the graph for real employee data — people, teams, projects, skills, and relationships. Use them to give accurate, data-driven answers.

Keep responses conversational and concise — 2-3 sentences. You're speaking aloud at a conference booth, so be engaging but brief. If someone asks about a person, team, or scenario, query the graph first to get real data before answering.

The visitor is currently exploring a scenario about Raj Patel, an Engineering Director who might be leaving. Answer their questions about the situation, the people involved, and potential next steps.${canvasInstructions}`
            }]
          },
          tools: [{ functionDeclarations: allTools }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      };
      console.log(`[Voice] Sending setup (canvas: ${this.canvasEnabled})...`);
      this._ws.send(JSON.stringify(setup));
      this._setupDone = true;
      console.log('[Voice] Setup sent, ready for audio');
    }

    _closeWebSocket() {
      if (this._ws) {
        this._ws.onclose = null;
        this._ws.close();
        this._ws = null;
      }
    }

    _sendAudio(pcmBuffer) {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._setupDone) return;
      const base64 = this._arrayBufferToBase64(pcmBuffer);
      this._ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: base64,
            mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}`
          }
        }
      }));
    }

    // --- Message handler ---

    _handleMessage(msg) {
      // Log message types for debugging
      const keys = Object.keys(msg);
      if (msg.serverContent?.inputTranscription) {
        console.log('[Voice] ← inputTranscription:', msg.serverContent.inputTranscription.text?.slice(0, 80));
      } else if (msg.serverContent?.outputTranscription) {
        console.log('[Voice] ← outputTranscription:', msg.serverContent.outputTranscription.text?.slice(0, 80));
      } else if (msg.serverContent?.modelTurn) {
        console.log('[Voice] ← audio chunk');
      } else if (msg.toolCall) {
        console.log('[Voice] ← toolCall:', msg.toolCall.functionCalls?.map(c => c.name));
      } else if (msg.serverContent?.turnComplete) {
        console.log('[Voice] ← turnComplete');
      } else if (msg.serverContent?.interrupted) {
        console.log('[Voice] ← interrupted');
      } else {
        console.log('[Voice] ← msg:', keys);
      }

      // Audio from model
      if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            if (this.state !== 'speaking') this._setState('speaking');
            this._queueAudio(part.inlineData.data);
          }
        }
      }

      // Input transcription (user speech)
      if (msg.serverContent?.inputTranscription) {
        const t = msg.serverContent.inputTranscription;
        if (t.text) {
          this._inputText += t.text;
          this.onInputTranscript(this._inputText, !!t.finished);
        }
        if (t.finished) {
          this._inputText = '';
          if (this.state === 'listening') this._setState('processing');
        }
      }

      // Output transcription (model speech)
      if (msg.serverContent?.outputTranscription) {
        const t = msg.serverContent.outputTranscription;
        if (t.text) {
          this._outputText += t.text;
          this.onOutputTranscript(this._outputText, !!t.finished);
        }
        if (t.finished) {
          this._outputText = '';
        }
      }

      // Turn complete
      if (msg.serverContent?.turnComplete) {
        this._onTurnComplete();
      }

      // Interrupted (user spoke over model)
      if (msg.serverContent?.interrupted) {
        this._stopPlayback();
        this._setState('listening');
      }

      // Tool calls
      if (msg.toolCall?.functionCalls) {
        this._handleToolCalls(msg.toolCall.functionCalls);
      }
    }

    async _handleToolCalls(calls) {
      const CANVAS_TOOLS = new Set(['show_cards', 'show_comparison', 'set_root']);
      const responses = [];

      for (const call of calls) {
        this.onToolCall(call.name, call.args);
        if (CANVAS_TOOLS.has(call.name)) {
          console.log(`[Voice] Canvas tool: ${call.name}`, call.args);
          this._handleCanvasTool(call.name, call.args);
          const cardIds = (call.args.cards || []).map(c => c.id).filter(Boolean);
          responses.push({ name: call.name, id: call.id, response: {
            success: true,
            rendered_card_ids: cardIds.length > 0 ? cardIds : undefined,
            note: cardIds.length > 0 ? 'Use these IDs as parentId to branch deeper' : undefined
          } });
        } else {
          try {
            const res = await fetch('/api/graph-tool', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: call.name, args: call.args })
            });
            const data = await res.json();
            const resultStr = JSON.stringify(data.result);
            const truncated = resultStr.length > 120000 ? resultStr.slice(0, 120000) + '...(truncated)' : resultStr;
            responses.push({
              name: call.name,
              id: call.id,
              response: JSON.parse(truncated)
            });
          } catch (e) {
            responses.push({
              name: call.name,
              id: call.id,
              response: { error: e.message }
            });
          }
        }
      }

      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({
          toolResponse: { functionResponses: responses }
        }));
      }
    }

    _handleCanvasTool(name, args) {
      const vc = window._voiceCanvas;
      if (!vc) {
        console.warn('[Voice] _voiceCanvas not available');
        return;
      }

      switch (name) {
        case 'set_root':
          if (args.entity) {
            const e = args.entity;
            e.avatarUrl = `https://mattcmorrell.github.io/ee-graph/data/avatars/${e.id}.jpg`;
            vc.ensureRoot({ entity: e });
          } else if (args.topic) {
            vc.ensureRoot({ topic: args.topic });
          }
          break;

        case 'show_cards':
          if (!vc.hasRoot()) {
            vc.ensureRoot({ topic: { title: 'Analysis', subtitle: '' } });
          }
          vc.showCards(args.cards || []);
          break;

        case 'show_comparison':
          vc.showComparison(args.options || []);
          break;
      }

      this.onCanvasCard(name, args);
    }

    _onTurnComplete() {
      this._inputText = '';
      this._outputText = '';
      // Wait for audio playback to finish before going back to listening
      if (this._isPlaying || (this._scheduledSources && this._scheduledSources.length > 0)) {
        this._drainThenListen = true;
      } else {
        this._setState('listening');
      }
    }

    // --- Mic ---

    async _startMic() {
      this._audioCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
      await this._audioCtx.audioWorklet.addModule('/audio-processor.js');

      this._micStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: MIC_SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });

      this._micNode = this._audioCtx.createMediaStreamSource(this._micStream);
      this._workletNode = new AudioWorkletNode(this._audioCtx, 'mic-processor');
      this._workletNode.port.onmessage = (e) => {
        this._sendAudio(e.data);
      };
      this._micNode.connect(this._workletNode);
      this._workletNode.connect(this._audioCtx.destination);
    }

    _stopMic() {
      if (this._workletNode) {
        this._workletNode.disconnect();
        this._workletNode = null;
      }
      if (this._micNode) {
        this._micNode.disconnect();
        this._micNode = null;
      }
      if (this._micStream) {
        this._micStream.getTracks().forEach(t => t.stop());
        this._micStream = null;
      }
      if (this._audioCtx) {
        this._audioCtx.close().catch(() => {});
        this._audioCtx = null;
      }
    }

    // --- Playback (scheduled buffers for gapless audio) ---

    _queueAudio(base64Data) {
      const bytes = atob(base64Data);
      const int16 = new Int16Array(bytes.length / 2);
      for (let i = 0; i < int16.length; i++) {
        int16[i] = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      }

      if (!this._playCtx || this._playCtx.state === 'closed') {
        this._playCtx = new AudioContext({ sampleRate: SPEAKER_SAMPLE_RATE });
        this._nextPlayTime = 0;
        this._scheduledSources = [];
      }

      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      const buffer = this._playCtx.createBuffer(1, float32.length, SPEAKER_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = this._playCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this._playCtx.destination);

      const now = this._playCtx.currentTime;
      const startAt = Math.max(now, this._nextPlayTime || 0);
      source.start(startAt);
      this._nextPlayTime = startAt + buffer.duration;

      this._scheduledSources = this._scheduledSources || [];
      this._scheduledSources.push(source);
      this._isPlaying = true;

      source.onended = () => {
        this._scheduledSources = (this._scheduledSources || []).filter(s => s !== source);
        if (this._scheduledSources.length === 0 && this._playbackQueue.length === 0) {
          this._isPlaying = false;
          if (this._drainThenListen) {
            this._drainThenListen = false;
            this._setState('listening');
          }
        }
      };
    }

    _stopPlayback() {
      this._playbackQueue = [];
      this._isPlaying = false;
      this._drainThenListen = false;
      this._nextPlayTime = 0;
      for (const s of (this._scheduledSources || [])) { try { s.stop(); } catch (e) {} }
      this._scheduledSources = [];
    }

    // --- Util ---

    _arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  }

  // Export
  window.VoiceManager = VoiceManager;
})();

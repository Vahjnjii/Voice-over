/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
  Type,
} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {audioBufferToWav, createBlob, decode, decodeAudioData} from './utils';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() status = 'Ready';
  @state() error = '';
  @state() textToSpeak = '';
  @state() downloadUrl: string | null = null;
  @state() isGeneratingAudio = false;
  @state() sourceScripts = '';
  @state() generatedScripts: string[] = [];
  @state() isGenerating = false;

  private client: GoogleGenAI;
  private session: Session;
  // @fix: Cast window to any to allow for webkitAudioContext property for broader browser support.
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  private spokenAudioBuffers: AudioBuffer[] = [];
  private speechEndTimer?: number;

  static styles = css`
    :host {
      width: 100vw;
      height: 100vh;
      display: flex;
      justify-content: center;
      color: white;
      font-family: 'Google Sans', sans-serif;
      box-sizing: border-box;
    }

    .container {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 1000px;
      margin: 0 auto;
      padding: 2rem;
      gap: 2rem;
      box-sizing: border-box;
      height: 100%;
    }

    .card {
      background: rgba(255, 255, 255, 0.05);
      padding: 1.5rem;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.9);
    }

    label {
      font-size: 0.9rem;
      color: rgba(255, 255, 255, 0.7);
    }

    textarea {
      flex-grow: 1;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(0, 0, 0, 0.2);
      color: white;
      padding: 16px;
      font-size: 16px;
      font-family: 'Roboto Mono', monospace;
      resize: vertical;
      min-height: 120px;
    }

    textarea:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.5);
    }

    button {
      outline: none;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.1);
      height: 50px;
      cursor: pointer;
      font-size: 16px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }

    button:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    button:disabled {
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.3);
      cursor: not-allowed;
    }

    .generated-scripts-container {
      overflow-y: auto;
      max-height: 25vh;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
      padding-right: 10px; /* for scrollbar */
    }

    .script-item {
      background: rgba(255, 255, 255, 0.1);
      padding: 1rem;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.2s, border-color 0.2s;
      font-size: 0.9rem;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .script-item:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .script-item.selected {
      border-color: #8ab4f8;
      background: rgba(138, 180, 248, 0.2);
    }

    .voice-controls {
      display: flex;
      gap: 10px;
      align-items: stretch;
    }

    .voice-controls textarea {
      min-height: 80px;
      height: 120px;
    }

    .voice-controls .button-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .voice-controls button, .voice-controls a {
      width: 140px;
      flex-shrink: 0;
    }
    
    a.button {
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      height: 50px;
      box-sizing: border-box;
      outline: none;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.1);
      cursor: pointer;
      font-size: 16px;
      transition: background 0.2s;
    }

    a.button:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    a.button[disabled] {
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.3);
      cursor: not-allowed;
      pointer-events: none;
    }

    .audio-player-container {
      margin-top: 1rem;
    }

    .audio-player-container audio {
      width: 100%;
    }

    #status {
      text-align: center;
      padding: 10px;
      font-size: 0.9rem;
      color: rgba(255, 255, 255, 0.8);
      min-height: 20px;
    }

    .error {
      color: #f88;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private async initClient() {
    // @fix: Use `process.env.API_KEY` as per the coding guidelines.
    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });
    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Ready');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.isGeneratingAudio = true;
              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              this.spokenAudioBuffers.push(audioBuffer);

              window.clearTimeout(this.speechEndTimer);
              this.speechEndTimer = window.setTimeout(() => {
                this.onSpeechEnd();
              }, 1000);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              this.spokenAudioBuffers = [];
              window.clearTimeout(this.speechEndTimer);
              this.isGeneratingAudio = false;
              this.updateStatus('Audio generation was interrupted.');
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session closed: ' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
          },
        },
      });
    } catch (e) {
      console.error(e);
      this.updateError((e as Error).message);
    }
  }

  private onSpeechEnd() {
    if (!this.isGeneratingAudio) return;
    this.isGeneratingAudio = false;
    this.updateStatus('Audio generation complete. Ready for playback.');
    this.generateDownloadableAudio();
  }

  private generateDownloadableAudio() {
    if (this.spokenAudioBuffers.length === 0) return;

    const numChannels = this.spokenAudioBuffers[0].numberOfChannels;
    const sampleRate = this.spokenAudioBuffers[0].sampleRate;
    const totalLength = this.spokenAudioBuffers.reduce(
      (acc, buffer) => acc + buffer.length,
      0,
    );

    const combinedBuffer = this.outputAudioContext.createBuffer(
      numChannels,
      totalLength,
      sampleRate,
    );

    let offset = 0;
    for (const buffer of this.spokenAudioBuffers) {
      for (let i = 0; i < numChannels; i++) {
        combinedBuffer.copyToChannel(buffer.getChannelData(i), i, offset);
      }
      offset += buffer.length;
    }

    const wavBlob = audioBufferToWav(combinedBuffer);
    this.downloadUrl = URL.createObjectURL(wavBlob);
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private handleSourceScriptsInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    this.sourceScripts = textarea.value;
  }

  private handleTextInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    this.textToSpeak = textarea.value;
  }

  private async selectScript(script: string) {
    if (this.isGeneratingAudio) return;
    this.textToSpeak = script;
    await this.generateAudio();
  }

  private async generateScripts() {
    if (!this.sourceScripts.trim() || !this.client) return;
    this.isGenerating = true;
    this.generatedScripts = [];
    this.textToSpeak = '';
    this.updateStatus('Analyzing scripts and generating new ideas...');

    const prompt = `You are an expert viral marketer and scriptwriter. Analyze the following scripts in-depth. Understand their structure, tone, hook, call to action, and pacing. Based on this deep analysis, generate 12 new, original viral scripts that follow the same successful patterns.

    Here are the scripts to analyze:
    ---
    ${this.sourceScripts}
    ---
    
    Return the 12 new scripts in a JSON object with a single key "scripts" which is an array of strings.`;

    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scripts: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },
            },
          },
        },
      });

      const jsonResponse = JSON.parse(response.text);
      this.generatedScripts = jsonResponse.scripts || [];
      if (this.generatedScripts.length > 0) {
        this.updateStatus(
          'Generated 12 new scripts. Creating voice-over for the first script...',
        );
        await this.selectScript(this.generatedScripts[0]);
      } else {
        this.updateError(
          'Could not generate scripts. The model returned an empty list.',
        );
      }
    } catch (e) {
      console.error(e);
      this.updateError(`Failed to generate scripts: ${(e as Error).message}`);
    } finally {
      this.isGenerating = false;
    }
  }

  private async generateAudio() {
    if (!this.textToSpeak.trim() || !this.session || this.isGeneratingAudio)
      return;

    try {
      // Reset for new audio generation
      this.isGeneratingAudio = true;
      this.spokenAudioBuffers = [];
      if (this.downloadUrl) {
        URL.revokeObjectURL(this.downloadUrl);
        this.downloadUrl = null;
      }
      window.clearTimeout(this.speechEndTimer);

      this.updateStatus('Generating audio...');
      await this.session.sendRealtimeInput({
        text: this.textToSpeak,
      });
    } catch (err) {
      this.isGeneratingAudio = false;
      console.error('Error sending text:', err);
      this.updateError(`Error sending text: ${(err as Error).message}`);
    }
  }

  render() {
    return html`
      <div class="container">
        <div class="card">
          <h2>Step 1: Generate Scripts</h2>
          <label for="source-scripts">
            Paste your collection of viral scripts here for analysis.
          </label>
          <textarea
            id="source-scripts"
            placeholder="Paste scripts here, one per line..."
            .value=${this.sourceScripts}
            @input=${this.handleSourceScriptsInput}
            ?disabled=${this.isGenerating}></textarea>
          <button @click=${this.generateScripts} ?disabled=${
            this.isGenerating || !this.sourceScripts.trim()
          }>
            ${
              this.isGenerating
                ? 'Generating...'
                : 'Analyze & Generate 12 Scripts'
            }
          </button>
          
          ${
            this.generatedScripts.length > 0
              ? html`
                  <div class="generated-scripts-container">
                    ${this.generatedScripts.map(
                      (script) => html`
                        <div
                          class="script-item ${this.textToSpeak === script
                            ? 'selected'
                            : ''}"
                          @click=${() => this.selectScript(script)}>
                          ${script}
                        </div>
                      `,
                    )}
                  </div>
                `
              : ''
          }
        </div>

        <div class="card">
          <h2>Step 2: Create Voice Over</h2>
          <div class="voice-controls">
            <textarea
              placeholder="Select a generated script above or type your own text here..."
              .value=${this.textToSpeak}
              @input=${this.handleTextInput}
              aria-label="Text to speak"></textarea>
            <div class="button-group">
              <button
                @click=${this.generateAudio}
                ?disabled=${!this.textToSpeak.trim() || this.isGeneratingAudio}
                aria-label="Generate audio">
                ${this.isGeneratingAudio ? 'Generating...' : 'Generate Audio'}
              </button>
              <a
                class="button"
                href=${this.downloadUrl ?? '#'}
                download="gemini-speech.wav"
                aria-label="Download speech audio"
                ?disabled=${!this.downloadUrl}>
                Download
              </a>
            </div>
          </div>
           ${
             this.downloadUrl
               ? html`
                   <div class="audio-player-container">
                     <audio controls src=${this.downloadUrl}></audio>
                   </div>
                 `
               : ''
           }
        </div>

        <div id="status" class=${this.error ? 'error' : ''}>
          ${this.error || this.status}
        </div>
      </div>
    `;
  }
}
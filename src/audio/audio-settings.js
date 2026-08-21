/**
 * AudioSettingsWidget — DOM panel with mute toggle + BGM/SFX sliders.
 * Mount into canvas.parentElement; positions itself at top-right.
 */
'use strict';

const STYLE = `
.wildwood-audio-panel {
  position: absolute;
  top: 12px;
  right: 232px;
  background: rgba(20, 18, 26, 0.88);
  border: 1px solid #4a3a2a;
  border-radius: 4px;
  padding: 8px 10px;
  font-family: 'Trebuchet MS', sans-serif;
  color: #d4a64a;
  font-size: 12px;
  user-select: none;
  pointer-events: auto;
  z-index: 50;
  min-width: 200px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.5);
}
.wildwood-audio-panel .row {
  display: flex;
  align-items: center;
  margin: 4px 0;
  gap: 6px;
}
.wildwood-audio-panel label {
  width: 32px;
  font-weight: bold;
  color: #c8a04a;
}
.wildwood-audio-panel input[type=range] {
  flex: 1;
  accent-color: #d4a64a;
  height: 4px;
}
.wildwood-audio-panel .val {
  width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #b89a3a;
}
.wildwood-audio-panel button.mute {
  background: #3a2a1a;
  color: #d4a64a;
  border: 1px solid #6a4a2a;
  border-radius: 3px;
  padding: 2px 8px;
  cursor: pointer;
  font: inherit;
  width: 100%;
  margin-top: 4px;
}
.wildwood-audio-panel button.mute:hover { background: #4a3a2a; }
.wildwood-audio-panel button.mute.muted { color: #aa3a3a; border-color: #6a2a2a; }
.wildwood-audio-panel h4 {
  margin: 0 0 4px 0;
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #b89a3a;
  border-bottom: 1px solid #4a3a2a;
  padding-bottom: 2px;
}
`;

export class AudioSettingsWidget {
  /**
   * @param {AudioManager} audio
   * @param {HTMLElement} parent
   */
  constructor(audio, parent) {
    this.audio = audio;
    this.parent = parent;
    this._build();
    this._refresh();
  }

  _build() {
    if (typeof document === 'undefined') return;
    if (!this.parent) return;
    // ensure unique host
    if (this.parent.querySelector('.wildwood-audio-panel')) return;
    const host = document.createElement('div');
    host.className = 'wildwood-audio-panel';
    host.innerHTML = `
      <style>${STYLE}</style>
      <h4>音频 Audio</h4>
      <div class="row">
        <label>BGM</label>
        <input type="range" min="0" max="100" value="60" class="bgm">
        <span class="val bgm-v">60</span>
      </div>
      <div class="row">
        <label>SFX</label>
        <input type="range" min="0" max="100" value="80" class="sfx">
        <span class="val sfx-v">80</span>
      </div>
      <button class="mute">🔊 声音开启</button>
    `;
    this.parent.appendChild(host);
    this.root = host;
    this.bgmSlider  = host.querySelector('input.bgm');
    this.sfxSlider  = host.querySelector('input.sfx');
    this.bgmVal     = host.querySelector('.bgm-v');
    this.sfxVal     = host.querySelector('.sfx-v');
    this.muteBtn    = host.querySelector('button.mute');

    this.bgmSlider.value = String(Math.round(this.audio.getBgmVolume() * 100));
    this.sfxSlider.value = String(Math.round(this.audio.getSfxVolume() * 100));
    this.bgmVal.textContent = this.bgmSlider.value;
    this.sfxVal.textContent = this.sfxSlider.value;

    this.bgmSlider.addEventListener('input', () => {
      const v = +this.bgmSlider.value / 100;
      this.audio.setBgmVolume(v);
      this.bgmVal.textContent = this.bgmSlider.value;
    });
    this.sfxSlider.addEventListener('input', () => {
      const v = +this.sfxSlider.value / 100;
      this.audio.setSfxVolume(v);
      this.sfxVal.textContent = this.sfxSlider.value;
    });
    this.muteBtn.addEventListener('click', () => {
      const next = !this.audio.isMuted();
      this.audio.setMuted(next);
      this._refresh();
    });
    this._refresh();
  }

  _refresh() {
    if (!this.muteBtn) return;
    if (this.audio.isMuted()) {
      this.muteBtn.textContent = '🔇 已静音';
      this.muteBtn.classList.add('muted');
    } else {
      this.muteBtn.textContent = '🔊 声音开启';
      this.muteBtn.classList.remove('muted');
    }
  }

  dispose() {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }
}

export function mountAudioSettings(audio, parent) {
  return new AudioSettingsWidget(audio, parent);
}

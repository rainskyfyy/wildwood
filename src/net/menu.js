/**
 * Wildwood v0.4 联机 — 主菜单 / 大厅 DOM 浮层。
 *
 * 提供三个阶段 UI:
 *   1. modeSelect()   — 单人 / 联机(host 创建 / 输入房间码加入)
 *   2. waiting()      — 等待房中,显示 code + 当前 peers + 离开按钮
 *   3. error(msg)     — 弹错
 *
 * 用法:
 *   const menu = new NetMenu(document.body);
 *   const result = await menu.show({ relayUrl: 'ws://localhost:8787' });
 *   // result = { mode: 'offline', name: 'Alice' } 或
 *   //          { mode: 'host',   code: 'ABCD', token, name, client, session }
 *   //          { mode: 'join',   code, token, name, client, session }
 *   //          { mode: 'cancel' }  用户取消
 *
 * 整体是单页 DOM,不依赖任何 CSS 框架;使用绝对定位覆盖在 canvas 之上。
 */

'use strict';

import { RelayClient } from './relay-client.js';
import { Session } from './session.js';
import { MODE_OFFLINE } from './session.js';

/* ---------- 工具 ---------- */

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'style') e.style.cssText = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') {
      e.addEventListener(k.slice(2), attrs[k]);
    } else if (k === 'html') {
      e.innerHTML = attrs[k];
    } else {
      e.setAttribute(k, attrs[k]);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function showOverlay(root) {
  const overlay = el('div', {
    class: 'ww-net-overlay',
    style: `
      position: fixed; inset: 0;
      background: rgba(13, 13, 24, 0.92);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-family: ui-monospace, "SF Mono", Consolas, monospace;
      color: #f0f0f0; z-index: 9999;
    `,
  });
  root.appendChild(overlay);
  return overlay;
}

function button(label, { primary = false, onClick } = {}) {
  return el('button', {
    style: `
      padding: 10px 24px; min-width: 180px;
      font-family: inherit; font-size: 14px; letter-spacing: 1px;
      background: ${primary ? '#d4a64a' : '#2a2a3a'};
      color: ${primary ? '#0d0d18' : '#f0f0f0'};
      border: 1px solid ${primary ? '#d4a64a' : '#444'};
      border-radius: 4px; cursor: pointer;
      transition: background 0.1s, transform 0.05s;
    `,
    onmouseenter: (e) => { e.target.style.background = primary ? '#e0b85a' : '#3a3a4a'; },
    onmouseleave: (e) => { e.target.style.background = primary ? '#d4a64a' : '#2a2a3a'; },
    onmousedown: (e) => { e.target.style.transform = 'scale(0.97)'; },
    onmouseup:   (e) => { e.target.style.transform = 'scale(1)'; },
    onclick: onClick || (() => {}),
  }, [label]);
}

function input({ placeholder = '', value = '', maxLength = 32, onKey = null } = {}) {
  const i = el('input', {
    type: 'text', placeholder, value,
    style: `
      padding: 8px 12px; min-width: 200px;
      font-family: inherit; font-size: 16px; letter-spacing: 2px;
      background: #1a1a2a; color: #f0f0f0;
      border: 1px solid #444; border-radius: 4px;
      text-transform: uppercase;
    `,
    maxlength: maxLength,
  });
  if (onKey) i.addEventListener('keydown', onKey);
  return i;
}

function row(...children) {
  return el('div', { style: 'display: flex; gap: 12px; margin: 8px 0; flex-wrap: wrap; justify-content: center;' }, children);
}

function label(text) {
  return el('div', { style: 'font-size: 12px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px;' }, [text]);
}

function panel(...children) {
  return el('div', {
    style: `
      background: #16162a; border: 1px solid #2a2a3a; border-radius: 6px;
      padding: 24px 32px; max-width: 480px; width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `,
  }, children);
}

function title(text) {
  return el('h1', {
    style: 'margin: 0 0 16px 0; font-size: 22px; color: #d4a64a; letter-spacing: 2px; text-align: center;'
  }, [text]);
}

function subtitle(text) {
  return el('div', { style: 'font-size: 13px; color: #888; text-align: center; margin-bottom: 16px;' }, [text]);
}

function error(text) {
  return el('div', {
    style: `
      color: #ff6b6b; background: rgba(255, 107, 107, 0.1);
      border: 1px solid rgba(255, 107, 107, 0.3);
      padding: 8px 12px; border-radius: 4px; font-size: 12px;
      margin-top: 12px; text-align: center;
    `
  }, [text]);
}

/* ---------- 主类 ---------- */

export class NetMenu {
  constructor(root) {
    this.root = root || document.body;
  }

  /**
   * 显示主菜单,等待用户选择。返回 Promise<NetMenuResult>。
   * NetMenuResult:
   *   - { mode: 'cancel' }                              — 用户取消
   *   - { mode: 'offline', name }                       — 单人
   *   - { mode: 'host',  name, code, token, client, session }
   *   - { mode: 'join',  name, code, token, client, session }
   */
  show({ relayUrl = 'ws://localhost:8787', defaultName = '' } = {}) {
    return new Promise((resolve) => {
      const overlay = showOverlay(this.root);
      const { modeSelect } = this._renderModeSelect(overlay, relayUrl, defaultName, resolve);
      modeSelect();
    });
  }

  _renderModeSelect(overlay, relayUrl, defaultName, resolve) {
    return {
      modeSelect: () => {
        overlay.innerHTML = '';
        const nameInput = input({ placeholder: '你的名字', value: defaultName, maxLength: 16 });
        const name = () => (nameInput.value || 'Player').trim().slice(0, 16) || 'Player';

        const titleEl = title('Wildwood · v0.4');
        const subEl = subtitle('2-4 人联机合作 · 类饥荒 × 星露谷');

        const offlineBtn = button('单人游戏', { primary: true, onClick: () => {
          overlay.remove();
          resolve({ mode: 'offline', name: name() });
        }});
        const hostBtn = button('创建房间', { onClick: async () => {
          const n = name();
          await this._flowHost(overlay, relayUrl, n, resolve);
        }});
        const joinBtn = button('加入房间', { onClick: async () => {
          const n = name();
          await this._flowJoin(overlay, relayUrl, n, resolve);
        }});

        const panelEl = panel(
          titleEl, subEl,
          label('昵称'),
          row(nameInput),
          row(offlineBtn, hostBtn, joinBtn),
          el('div', { style: 'font-size: 11px; color: #555; text-align: center; margin-top: 16px;' },
            [`Relay: ${relayUrl}`]
          )
        );
        overlay.appendChild(panelEl);
        setTimeout(() => nameInput.focus(), 50);
      },
    };
  }

  async _flowHost(overlay, relayUrl, name, resolve) {
    overlay.innerHTML = '';
    const titleEl = title('创建房间…');
    const subEl = subtitle('正在连接中继服务器');
    const panelEl = panel(titleEl, subEl, this._spinner());
    overlay.appendChild(panelEl);

    const client = new RelayClient(relayUrl, { autoReconnectMs: 0 });
    const session = new Session();
    const cleanup = (reason) => {
      client.removeAll();
      client.disconnect();
      session.removeAll();
      if (reason) console.warn(`[net] host flow ended: ${reason}`);
    };
    // v0.8.18-P0: await client.connect() 后再 host(),避免在 CONNECTING 态发指令触发 "ws not open"。
    // done 守卫:connect reject 与 'error'/'close' 事件会竞争,靠它保证只弹一次错。
    let done = false;
    const retry = () => this._renderModeSelect(overlay, relayUrl, name, resolve).modeSelect();
    client.on('error', (e) => {
      if (done) return; done = true;
      this._showError(overlay, relayUrl, `连接失败:${e?.message || e}`, retry);
      cleanup('error');
    });
    client.on('error_msg', (m) => {
      if (done) return; done = true;
      this._showError(overlay, relayUrl, `服务器错误:${m.msg || m.err}`, retry);
      cleanup('error_msg');
    });
    client.on('kicked', (m) => {
      if (done) return; done = true;
      this._showError(overlay, relayUrl, `被踢出:${m.reason || ''}`, retry);
      cleanup('kicked');
    });
    client.on('hosted', (m) => {
      if (done) return; done = true;
      session.setHosted({ code: m.code, token: m.token });
      this._renderLobby(overlay, relayUrl, name, client, session, resolve, /*isHost*/ true);
    });

    try {
      await client.connect();
      client.host(name);
    } catch (e) {
      if (done) return; done = true;
      this._showError(overlay, relayUrl, `启动失败:${e?.message || e}`, retry);
      cleanup('host start failed');
    }
  }

  async _flowJoin(overlay, relayUrl, name, resolve) {
    overlay.innerHTML = '';
    const titleEl = title('加入房间');
    const subEl = subtitle('输入 4 位房间码(大写字母)');
    const codeInput = input({ placeholder: 'ABCD', value: '', maxLength: 4 });
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    });
    const cancelBtn = button('取消', { onClick: () => {
      overlay.remove();
      resolve({ mode: 'cancel' });
    }});
    const okBtn = button('加入', { primary: true, onClick: () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) {
        showInputError('房间码必须是 4 位大写字母');
        return;
      }
      this._doJoin(overlay, relayUrl, name, code, resolve);
    }});
    const inputErr = el('div');
    const showInputError = (msg) => {
      inputErr.innerHTML = '';
      inputErr.appendChild(error(msg));
    };
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') okBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });

    const panelEl = panel(
      titleEl, subEl,
      label('房间码'),
      row(codeInput),
      row(okBtn, cancelBtn),
      inputErr,
    );
    overlay.appendChild(panelEl);
    setTimeout(() => codeInput.focus(), 50);
  }

  async _doJoin(overlay, relayUrl, name, code, resolve) {
    overlay.innerHTML = '';
    overlay.appendChild(panel(title('加入房间…'), subtitle(`正在加入 ${code}`), this._spinner()));

    const client = new RelayClient(relayUrl, { autoReconnectMs: 0 });
    const session = new Session();
    const cleanup = () => {
      client.removeAll();
      client.disconnect();
      session.removeAll();
    };
    // v0.8.18-P0: await client.connect() 后再 join(),避免在 CONNECTING 态发指令触发 "ws not open"。
    // done 守卫:connect reject 与 'error' 事件竞争,靠它保证只弹一次错。
    let done = false;
    const retry = () => this._renderModeSelect(overlay, relayUrl, name, resolve).modeSelect();
    client.on('error', (e) => {
      if (done) return; done = true;
      this._showError(overlay, relayUrl, `连接失败:${e?.message || e}`, retry);
      cleanup();
    });
    client.on('error_msg', (m) => {
      if (done) return; done = true;
      this._showError(overlay, relayUrl, `加入失败:${m.msg || m.err}`, retry);
      cleanup();
    });
    client.on('joined', (m) => {
      if (done) return; done = true;
      session.setJoined({ token: m.token, id: m.id, code: m.code, snapshot: m.snapshot });
      this._renderLobby(overlay, relayUrl, name, client, session, resolve, /*isHost*/ false);
    });

    try {
      await client.connect();
      client.join(code, name);
    } catch (e) {
      if (done) return; done = true;
      this._showError(overlay, relayUrl, `启动失败:${e?.message || e}`, retry);
      cleanup();
    }
  }

  _renderLobby(overlay, relayUrl, name, client, session, resolve, isHost) {
    overlay.innerHTML = '';
    const codeBox = el('div', {
      style: `
        font-size: 48px; font-weight: 700; letter-spacing: 12px;
        color: #d4a64a; background: #0d0d18;
        padding: 16px 24px; border: 1px solid #d4a64a;
        border-radius: 4px; text-align: center;
        cursor: pointer; user-select: all;
        font-family: ui-monospace, "SF Mono", Consolas, monospace;
      `,
      title: '点击复制',
      onclick: () => {
        const code = session.code || '';
        if (navigator.clipboard && code) {
          navigator.clipboard.writeText(code).catch(() => {});
        }
      },
    }, [session.code || '----']);

    const peerList = el('div', { style: 'min-height: 100px;' });
    const updatePeerList = () => {
      peerList.innerHTML = '';
      const self = el('div', { style: 'padding: 6px 8px; color: #d4a64a;' }, [`▸ ${name} (你, ${isHost ? '房主' : '玩家'})`]);
      peerList.appendChild(self);
      if (session.peers.size === 0) {
        peerList.appendChild(el('div', { style: 'padding: 6px 8px; color: #666; font-style: italic;' },
          ['等待其他玩家加入…']));
      } else {
        for (const p of session.peers.values()) {
          peerList.appendChild(el('div', { style: 'padding: 6px 8px; color: #ccc;' },
            [`▸ ${p.name}${p.state ? ` (${p.state.x?.toFixed?.(1) || '?'}, ${p.state.y?.toFixed?.(1) || '?'})` : ''}`]));
        }
      }
    };
    session.on('peer_added', updatePeerList);
    session.on('peer_removed', updatePeerList);
    session.on('peer_updated', updatePeerList);
    updatePeerList();

    const startBtn = isHost
      ? button('开始游戏', { primary: true, onClick: () => {
          overlay.remove();
          resolve({ mode: 'host', name, code: session.code, token: session.token,
                    client, session, selfId: session.self.id });
        }})
      : el('div', { style: 'font-size: 12px; color: #888; text-align: center; padding: 10px;' },
          ['等待房主开始游戏…']);

    const leaveBtn = button(isHost ? '关闭房间' : '离开房间', { onClick: () => {
      try { client.leave(); } catch (_) {}
      overlay.remove();
      resolve({ mode: 'cancel' });
    }});

    const hint = el('div', { style: 'font-size: 11px; color: #555; text-align: center; margin-top: 8px;' },
      isHost ? '把房间码发给朋友,他们选择"加入房间"输入即可' : '已连接中继,房主开始游戏后会进入');

    const panelEl = panel(
      title(isHost ? '房间已创建' : '已加入房间'),
      subtitle(isHost ? '你的房间码' : `房间 ${session.code}`),
      row(codeBox),
      el('div', { style: 'margin-top: 16px;' }, [
        label('玩家'),
        el('div', {
          style: 'background: #0d0d18; border: 1px solid #2a2a3a; border-radius: 4px; padding: 4px;'
        }, [peerList]),
      ]),
      row(startBtn, leaveBtn),
      hint,
    );
    overlay.appendChild(panelEl);

    // 错误时回到主菜单
    const onErr = (msg) => this._showError(overlay, relayUrl, msg,
      () => this._renderModeSelect(overlay, relayUrl, name, resolve).modeSelect());
    client.once?.('kicked', () => onErr('被踢出房间'));
    client.once?.('error_msg', (m) => onErr(m.msg || m.err || '未知错误'));
  }

  _showError(overlay, relayUrl, msg, onRetry) {
    overlay.innerHTML = '';
    const retryBtn = button('重试', { primary: true, onClick: onRetry });
    const cancelBtn = button('返回主菜单', { onClick: () => overlay.remove() });
    overlay.appendChild(panel(
      title('出错了'),
      error(msg),
      row(retryBtn, cancelBtn),
    ));
  }

  _spinner() {
    return el('div', {
      style: `
        width: 32px; height: 32px; margin: 16px auto 0;
        border: 3px solid #2a2a3a; border-top-color: #d4a64a;
        border-radius: 50%; animation: ww-spin 0.8s linear infinite;
      `
    },
      [el('style', {}, [`
        @keyframes ww-spin { to { transform: rotate(360deg); } }
      `])]
    );
  }
}

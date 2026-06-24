// Chat system: the chat box (log, input, hint), open/close state, and line
// rendering. Internal runtime system on the GameSystem lifecycle. Network
// and input land here through thunks because the chat box must mount into
// hudEl before the engine objects exist (DOM order in the HUD is part of the
// visual contract); the thunks are only called on user interaction.

import type { GameSystem } from '../../sdk'
import type { Input } from '../../engine/input'
import type { Net } from '../../engine/network'
import { el } from '../dom'

export interface ChatSystem extends GameSystem {
  readonly isOpen: boolean
  open(): void
  addLine(name: string, text: string, system?: boolean): void
}

export function createChatSystem(deps: {
  hudEl: HTMLElement
  enabled: boolean
  playerName: string
  getInput: () => Input
  getNet: () => Net
  /** local echo when the offline send fails: bubble above own avatar */
  say: (text: string) => void
}): ChatSystem {
  const { hudEl, enabled, playerName, getInput, getNet, say } = deps

  const chatBox = el('div', 'chat-box')
  const chatLog = el('div', 'chat-log')
  const chatInput = document.createElement('input')
  chatInput.className = 'chat-input'
  chatInput.maxLength = 200
  chatInput.placeholder = 'Say something…'
  const chatHint = el('div', 'chat-hint')
  chatHint.textContent = 'Press / to chat'
  chatBox.append(chatLog, chatInput, chatHint)
  hudEl.appendChild(chatBox)
  if (!enabled) chatBox.style.display = 'none'

  let chatOpen = false

  function addLine(name: string, text: string, system = false) {
    const line = el('div', 'chat-line' + (system ? ' sys' : ''))
    if (system) {
      line.textContent = text
    } else {
      const b = document.createElement('b')
      b.textContent = name + ': '
      line.appendChild(b)
      line.appendChild(document.createTextNode(text))
    }
    chatLog.appendChild(line)
    while (chatLog.children.length > 8) chatLog.firstChild?.remove()
    setTimeout(() => line.remove(), 9500)
  }

  function open() {
    chatOpen = true
    getInput().captured = true
    chatInput.classList.add('open')
    chatHint.style.display = 'none'
    setTimeout(() => chatInput.focus(), 0)
  }
  function close() {
    chatOpen = false
    getInput().captured = false
    chatInput.value = ''
    chatInput.classList.remove('open')
    chatHint.style.display = ''
    chatInput.blur()
  }

  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      const text = chatInput.value.trim()
      if (text) {
        if (!getNet().sendChat(text)) {
          addLine(playerName, text)
          say(text)
        }
      }
      close()
    } else if (e.key === 'Escape') {
      close()
    }
  })

  return {
    id: 'blobcade:chat',
    get isOpen() { return chatOpen },
    open,
    addLine,
  }
}

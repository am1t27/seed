import { normalizeWord } from './seed'

// The input, the caption and the two actions. No framework: a handful of elements.

export interface UiHandlers {
  onWord(word: string): void
  onType(word: string): void
  onSave(): Promise<void>
}

export interface Ui {
  showWord(word: string, settled: boolean): void
  showRecording(message: string): void
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

export function shareUrl(word: string): string {
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('w', word)
  return url.toString()
}

// The address with the word taken out and everything else left as written. A typed
// word is never put in the address bar, so a refresh starts over from the default;
// only a link someone chose to copy carries a word.
export function withoutWord(href: string): string {
  const url = new URL(href)
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '' && part !== 'w' && !part.startsWith('w='))
  url.search = kept.length > 0 ? `?${kept.join('&')}` : ''
  return url.toString()
}

export function createUi(handlers: UiHandlers): Ui {
  const form = $<HTMLFormElement>('word-form')
  const input = $<HTMLInputElement>('word')
  const caption = $<HTMLParagraphElement>('caption')
  const save = $<HTMLButtonElement>('save')
  const share = $<HTMLButtonElement>('share')
  let current = ''

  const flash = (button: HTMLButtonElement, text: string): void => {
    const original = button.dataset.label ?? button.textContent ?? ''
    button.dataset.label = original
    button.textContent = text
    window.setTimeout(() => (button.textContent = original), 1800)
  }

  const showWord = (word: string, settled: boolean): void => {
    current = word
    // textContent only: the word comes from the URL, so it never touches innerHTML.
    const name = document.createElement('em')
    name.textContent = word
    caption.replaceChildren('grown from the word ', name)
    if (settled) {
      document.body.dataset.state = 'settled'
      input.placeholder = 'type another word'
    }
  }

  // Every keystroke, not only submit: the organism reshapes as the word is typed.
  input.addEventListener('input', () => handlers.onType(normalizeWord(input.value)))

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const word = normalizeWord(input.value)
    if (!word) return
    input.value = ''
    // On touch screens, drop the keyboard so the organism is visible.
    if (matchMedia('(pointer: coarse)').matches) input.blur()
    handlers.onWord(word)
  })

  // Implicit submission on Enter is not reliable in every embedded browser, so ask for it.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    form.requestSubmit()
  })

  save.addEventListener('click', () => {
    save.disabled = true
    save.textContent = 'rendering the poster'
    handlers
      .onSave()
      .then(() => (save.textContent = 'poster saved'))
      .catch((error) => {
        console.error(error)
        save.textContent = 'the poster failed, try again'
      })
      .finally(() => {
        save.disabled = false
        window.setTimeout(() => (save.textContent = 'save poster'), 2200)
      })
  })

  share.addEventListener('click', () => {
    const url = shareUrl(current)
    // Phones get the native share sheet; everything else copies the link.
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: document.title, url }).catch(() => undefined)
      return
    }
    navigator.clipboard
      .writeText(url)
      .then(() => flash(share, 'link copied'))
      .catch(() => window.prompt('Copy this link', url))
  })

  // Desktop: typing anywhere lands in the input. Touch: no autofocus, no surprise keyboard.
  if (matchMedia('(pointer: fine)').matches) {
    input.focus({ preventScroll: true })
    window.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.length === 1 && event.key !== '`' && document.activeElement !== input) {
        input.focus({ preventScroll: true })
      }
    })
  }

  return {
    showWord,
    showRecording(message: string): void {
      document.body.dataset.state = 'recording'
      caption.textContent = message
    },
  }
}

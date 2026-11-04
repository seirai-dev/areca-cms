export type Theme = 'dark' | 'light'

export const THEME_KEY = 'areca-landing-theme'

// Runs before first paint (inlined in <head>) so light mode never flashes dark.
export const themeBootScript = `try{if(localStorage.getItem('${THEME_KEY}')==='light')document.documentElement.classList.add('light')}catch(e){}`

export function readTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f6f6f4' : '#0e0e10')
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

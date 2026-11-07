import { createContext, useContext } from 'react'

/**
 * Appearance variables have to reach portalled overlays too: React portals keep
 * the React tree but leave the DOM subtree, so a CSS variable declared on
 * `.tc-root` would not apply to a dialog rendered into `document.body`.
 */
export const ThemeContext = createContext({})

export function useThemeStyle() {
  return useContext(ThemeContext) || {}
}

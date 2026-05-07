/**
 * Built-in react-admin theme pairs. Each entry is one named theme that
 * carries its own light + dark variant; the standard light/dark toggle
 * (the sun/moon button in the AppBar) flips between them within a pair.
 *
 * The currently-selected pair is held in localStorage under 'themeName'
 * via ThemeContext, so the choice survives reload.
 */
import {
  defaultLightTheme,
  defaultDarkTheme,
  bwLightTheme,
  bwDarkTheme,
  nanoLightTheme,
  nanoDarkTheme,
  radiantLightTheme,
  radiantDarkTheme,
  houseLightTheme,
  houseDarkTheme,
} from 'react-admin';
import type { RaThemeOptions } from 'react-admin';

export interface NamedTheme {
  name: string;
  label: string;
  description: string;
  light: RaThemeOptions;
  dark: RaThemeOptions;
}

export const THEMES: NamedTheme[] = [
  {
    name: 'default',
    label: 'Default',
    description: "react-admin's stock Material UI palette",
    light: defaultLightTheme,
    dark: defaultDarkTheme,
  },
  {
    name: 'nano',
    label: 'Nano',
    description: 'Compact, dense — fits more rows on screen',
    light: nanoLightTheme,
    dark: nanoDarkTheme,
  },
  {
    name: 'radiant',
    label: 'Radiant',
    description: 'Bright, saturated, high-contrast',
    light: radiantLightTheme,
    dark: radiantDarkTheme,
  },
  {
    name: 'house',
    label: 'House',
    description: 'Warm, paper-like neutral',
    light: houseLightTheme,
    dark: houseDarkTheme,
  },
  {
    name: 'bw',
    label: 'B&W',
    description: 'Black and white — print-style minimal',
    light: bwLightTheme,
    dark: bwDarkTheme,
  },
];

export const DEFAULT_THEME_NAME = 'nano';

export function getThemeByName(name: string): NamedTheme {
  return THEMES.find(t => t.name === name) ?? THEMES[0];
}

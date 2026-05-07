/**
 * Custom AppBar that adds a "Theme" dropdown alongside the stock react-admin
 * light/dark toggle. Picking an item switches between the five built-in
 * named themes (Default / Nano / Radiant / House / B&W) — choice persists
 * via ThemeContext + localStorage.
 */
import { AppBar, TitlePortal, ToggleThemeButton } from 'react-admin';
import { useState } from 'react';
import {
  Box,
  Button,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import CheckIcon from '@mui/icons-material/Check';
import { useThemeName } from './ThemeContext';
import { THEMES } from './themes';

function ThemePickerButton() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { themeName, setThemeName } = useThemeName();
  const current = THEMES.find(t => t.name === themeName) ?? THEMES[0];
  return (
    <>
      <Tooltip title="Switch theme">
        <Button
          color="inherit"
          startIcon={<PaletteIcon />}
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          sx={{ textTransform: 'none', mr: 0.5 }}
        >
          {current.label}
        </Button>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
      >
        {THEMES.map(t => (
          <MenuItem
            key={t.name}
            selected={t.name === themeName}
            onClick={() => { setThemeName(t.name); setAnchor(null); }}
            sx={{ minWidth: 240 }}
          >
            <ListItemIcon>
              {t.name === themeName ? <CheckIcon fontSize="small" /> : <Box sx={{ width: 20 }} />}
            </ListItemIcon>
            <ListItemText
              primary={t.label}
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {t.description}
                </Typography>
              }
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default function MyAppBar() {
  return (
    <AppBar toolbar={
      <>
        <ThemePickerButton />
        <ToggleThemeButton />
      </>
    }>
      <TitlePortal />
    </AppBar>
  );
}

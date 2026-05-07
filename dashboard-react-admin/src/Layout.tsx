import { Layout as RaLayout } from 'react-admin';
import type { ReactNode } from 'react';
import { Box, useTheme } from '@mui/material';
import MyAppBar from './MyAppBar';
import MyMenu from './MyMenu';

/**
 * Wraps react-admin's stock <Layout>. Two visual rules:
 *
 * 1. Black content canvas — opt-in, only when the user is on Nano AND in
 *    dark mode. Other themes keep their stock dark background; light modes
 *    are untouched.
 * 2. Sidebar background tracks the AppBar's color in every theme so the
 *    left rail and the top bar read as one piece of chrome.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  // We ship Nano only; black canvas applies whenever Nano is in dark mode.
  const blackCanvas = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        ...(blackCanvas && {
          // && doubles selector specificity in emotion so this beats
          // react-admin's RaLayout-content style. !important is the
          // belt-and-suspenders for any theme rule with even higher
          // specificity that lands later.
          '&& .RaLayout-content': {
            backgroundColor: '#000 !important',
          },
        }),
        // Sidebar tracks the AppBar color so the chrome reads as one piece.
        // Uses palette.AppBar.darkBg when set (Material themes provide it
        // via overlay); falls back to primary.main which is what AppBar
        // defaults to in light themes.
        '& .RaSidebar-fixed, & .RaMenu-root': (t) => {
          const palette = t.palette as typeof t.palette & {
            AppBar?: { darkBg?: string; darkColor?: string };
          };
          return {
            backgroundColor: palette.AppBar?.darkBg ?? palette.primary.main,
            color: palette.AppBar?.darkColor ?? palette.primary.contrastText,
            '& .MuiListItemIcon-root, & .MuiTypography-root, & .MuiListItemText-primary': {
              color: 'inherit',
            },
          };
        },
      }}
    >
      <RaLayout appBar={MyAppBar} menu={MyMenu}>{children}</RaLayout>
    </Box>
  );
}

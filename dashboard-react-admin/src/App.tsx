import { Admin, Resource } from 'react-admin';
import { BrowserRouter } from 'react-router-dom';
import { dataProvider } from './dataProvider';
import { TestList, TestShow } from './resources/tests';
import { RunList, RunShow } from './resources/runs';
import { ThemeNameProvider, useThemeName } from './ThemeContext';
import { getThemeByName } from './themes';
import Layout from './Layout';

const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');

function ThemedAdmin() {
  const { themeName } = useThemeName();
  const t = getThemeByName(themeName);
  return (
    <Admin
      key={themeName /* force remount on theme switch so MUI styles re-cascade */}
      dataProvider={dataProvider}
      title="DIGIT integration tests"
      theme={t.light}
      darkTheme={t.dark}
      layout={Layout}
    >
      <Resource name="tests" list={TestList} show={TestShow} recordRepresentation="title" />
      <Resource name="runs" list={RunList} show={RunShow} recordRepresentation="id" />
    </Admin>
  );
}

export default function App() {
  return (
    <ThemeNameProvider>
      <BrowserRouter basename={BASENAME}>
        <ThemedAdmin />
      </BrowserRouter>
    </ThemeNameProvider>
  );
}

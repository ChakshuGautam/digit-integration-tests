import { Admin, Resource } from 'react-admin';
import { BrowserRouter } from 'react-router-dom';
import { dataProvider } from './dataProvider';
import { TestList, TestShow } from './resources/tests';
import { RunList, RunShow } from './resources/runs';

// react-admin <Admin> wraps its children in its own router. When deployed
// under a non-root base (e.g. /tests-v2/), passing the basename to <Admin>
// alone produced a "Router can't match URL '/'" warning and a blank page.
// Wrapping in our own BrowserRouter with basename + omitting basename from
// <Admin> resolves the routing confusion.
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
    <Admin
      dataProvider={dataProvider}
      title="DIGIT integration tests"
    >
      <Resource
        name="tests"
        list={TestList}
        show={TestShow}
        recordRepresentation="title"
      />
      <Resource
        name="runs"
        list={RunList}
        show={RunShow}
        recordRepresentation="id"
      />
    </Admin>
    </BrowserRouter>
  );
}

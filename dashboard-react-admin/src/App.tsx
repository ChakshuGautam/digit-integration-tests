import { Admin, Resource } from 'react-admin';
import { dataProvider } from './dataProvider';
import { TestList, TestShow } from './resources/tests';
import { RunList, RunShow } from './resources/runs';

export default function App() {
  return (
    <Admin
      dataProvider={dataProvider}
      title="DIGIT integration tests"
      basename={import.meta.env.BASE_URL.replace(/\/$/, '')}
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
  );
}

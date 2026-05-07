import {
  List,
  Datagrid,
  TextField,
  FunctionField,
  Show,
  SimpleShowLayout,
  TextInput,
  SelectArrayInput,
  ChipField,
  SingleFieldList,
  ArrayField,
  TopToolbar,
  FilterButton,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { useMemo } from 'react';
import type { CatalogTest } from '../types';

/**
 * Read all tests, derive the unique values for one tag-facet, and feed
 * them as choices to a SelectArrayInput. Hook-based so it has to live
 * inside a component — callers wrap in <FacetSelectInput facet="…" />.
 */
function FacetSelectInput({ facet, label }: { facet: string; label: string }) {
  const { data } = useGetList<CatalogTest>('tests', {
    pagination: { page: 1, perPage: 1000 },
  });
  const choices = useMemo(() => {
    const seen = new Set<string>();
    for (const t of data ?? []) {
      for (const tag of t.tags) {
        const m = tag.match(/^@([a-z]+):(.+)$/i);
        if (m && m[1] === facet) seen.add(m[2]);
      }
    }
    return Array.from(seen).sort().map(v => ({ id: `@${facet}:${v}`, name: v }));
  }, [data, facet]);
  // tags_any is read by dataProvider.ts — multi-select OR-within-facet.
  return <SelectArrayInput source="tags_any" label={label} choices={choices} />;
}

const TestFilters = [
  <TextInput key="q" source="q" label="Search title or file" alwaysOn resettable />,
  <FacetSelectInput key="persona" facet="persona" label="Persona" />,
  <FacetSelectInput key="area" facet="area" label="Area" />,
  <FacetSelectInput key="layer" facet="layer" label="Layer" />,
  <FacetSelectInput key="kind" facet="kind" label="Kind" />,
];

const ListActions = () => (
  <TopToolbar>
    <FilterButton />
  </TopToolbar>
);

export const TestList = () => (
  <List filters={TestFilters} actions={<ListActions />} perPage={50} sort={{ field: 'file', order: 'ASC' }}>
    <Datagrid rowClick="show" bulkActionButtons={false}>
      <TextField source="title" />
      <FunctionField label="File" render={(r: CatalogTest) => `${r.file}:${r.line}`} />
      <FunctionField
        label="Tags"
        render={(r: CatalogTest) =>
          r.tags.map(t => t.replace(/^@\w+:/, '')).slice(0, 4).join(' · ')
        }
      />
      <TextField source="lastStatus" label="Last status" />
      <FunctionField
        label="Duration"
        render={(r: CatalogTest) =>
          r.lastDurationMs == null
            ? '—'
            : r.lastDurationMs < 1000
              ? `${Math.round(r.lastDurationMs)}ms`
              : `${(r.lastDurationMs / 1000).toFixed(1)}s`
        }
      />
    </Datagrid>
  </List>
);

const VideoBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.latestRun?.videoUrl) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: '0 0 6px 0', fontSize: 12, textTransform: 'uppercase', color: '#888' }}>Video</h4>
      <video src={r.latestRun.videoUrl} controls preload="metadata" style={{ width: '100%', maxHeight: 360, background: 'black' }} />
    </div>
  );
};

const DescriptionBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.description) return <p style={{ color: '#888' }}>No description.</p>;
  return (
    <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55 }}>
      {r.description}
    </div>
  );
};

const SourceBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.source) return null;
  return (
    <pre style={{
      background: '#0d1117', color: '#e6edf3', padding: 10,
      borderRadius: 4, fontSize: 12, overflow: 'auto', maxHeight: 480,
    }}>{r.source}</pre>
  );
};

export const TestShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="title" />
      <TextField source="describe" label="Describe" />
      <FunctionField label="Location" render={(r: CatalogTest) => `${r.file}:${r.line}`} />
      <ArrayField source="tags"><SingleFieldList linkType={false}><ChipField source="" /></SingleFieldList></ArrayField>
      <TextField source="lastStatus" label="Last status" />
      <DescriptionBlock />
      <VideoBlock />
      <SourceBlock />
    </SimpleShowLayout>
  </Show>
);

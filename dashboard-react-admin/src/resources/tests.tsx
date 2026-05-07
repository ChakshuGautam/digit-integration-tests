import {
  List,
  Datagrid,
  TextField,
  FunctionField,
  Show,
  SimpleShowLayout,
  TextInput,
  SelectArrayInput,
  TopToolbar,
  FilterButton,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { useMemo } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import type { CatalogTest, TestStatus } from '../types';

// ---------------------------------------------------------------------------
// Filters: every facet always-on alongside search; no "Add filter" dropdown.
// ---------------------------------------------------------------------------

/**
 * Choices for SelectArrayInput, derived live from the catalog. We compute
 * them once at module level as a Promise — since the dataProvider caches
 * the catalog after the first fetch, react-admin's first useGetList call
 * fills the choices on subsequent renders.
 */
function FacetChoices(facet: string) {
  const { data } = useGetList<CatalogTest>('tests', {
    pagination: { page: 1, perPage: 1000 },
  });
  return useMemo(() => {
    const seen = new Set<string>();
    for (const t of data ?? []) {
      for (const tag of t.tags) {
        const m = tag.match(/^@([a-z]+):(.+)$/i);
        if (m && m[1] === facet) seen.add(m[2]);
      }
    }
    return Array.from(seen).sort().map(v => ({ id: `@${facet}:${v}`, name: v }));
  }, [data, facet]);
}

// react-admin reads `alwaysOn` from the outer JSX element in the filter
// array. Keeping each facet input as a top-level <SelectArrayInput> in
// the array (no wrapper component) makes alwaysOn visible to the List.
type FilterPassthrough = { alwaysOn?: boolean };

function PersonaFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_persona" label="Persona" choices={FacetChoices('persona')} sx={{ minWidth: 160 }} {...props} />;
}
function AreaFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_area" label="Area" choices={FacetChoices('area')} sx={{ minWidth: 180 }} {...props} />;
}
function LayerFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_layer" label="Layer" choices={FacetChoices('layer')} sx={{ minWidth: 140 }} {...props} />;
}
function KindFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_kind" label="Kind" choices={FacetChoices('kind')} sx={{ minWidth: 160 }} {...props} />;
}

const TestFilters = [
  <TextInput key="q" source="q" label="Search title or file" alwaysOn resettable sx={{ minWidth: 220 }} />,
  <PersonaFilter key="persona" alwaysOn />,
  <AreaFilter key="area" alwaysOn />,
  <LayerFilter key="layer" alwaysOn />,
  <KindFilter key="kind" alwaysOn />,
];

// ---------------------------------------------------------------------------
// Cell renderers: chips for tags, colored badge for status, monospace path.
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<TestStatus | 'never', 'success' | 'error' | 'warning' | 'default'> = {
  passed: 'success',
  failed: 'error',
  timedOut: 'error',
  interrupted: 'error',
  skipped: 'warning',
  never: 'default',
};

function StatusBadge() {
  const r = useRecordContext<CatalogTest>();
  const status = (r?.lastStatus ?? 'never') as TestStatus | 'never';
  return (
    <Chip
      size="small"
      label={status}
      color={STATUS_COLORS[status] ?? 'default'}
      variant={status === 'never' ? 'outlined' : 'filled'}
    />
  );
}

const FACET_CHIP_COLOR: Record<string, 'primary' | 'secondary' | 'info' | 'default' | 'warning' | 'success'> = {
  persona: 'primary',
  area: 'info',
  layer: 'default',
  kind: 'secondary',
  ccrs: 'warning',
  pr: 'warning',
  health: 'success',
};

function TagsCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  const visible = r.tags.slice(0, 6);
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {visible.map(t => {
        const m = t.match(/^@([a-z]+):(.+)$/i);
        const facet = m?.[1] ?? 'other';
        const value = m?.[2] ?? t;
        return (
          <Chip
            key={t}
            size="small"
            label={value}
            color={FACET_CHIP_COLOR[facet] ?? 'default'}
            variant="outlined"
            sx={{ height: 20, fontSize: 11 }}
          />
        );
      })}
      {r.tags.length > visible.length && (
        <Typography variant="caption" color="text.secondary">+{r.tags.length - visible.length}</Typography>
      )}
    </Stack>
  );
}

function FileCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'text.secondary' }}>
      {r.file}:{r.line}
    </Typography>
  );
}

function TitleCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }}>{r.title}</Typography>
      {r.describe && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
          {r.describe}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Sparkline of the last 5 run outcomes for this test. Mirrors the vanilla
 * dashboard's dot row: green=passed, red=failed/timedOut, amber=skipped,
 * outlined=no entry. Hover any dot for the run-id + duration.
 */
const HISTORY_SLOTS = 5;
const HISTORY_COLOR: Record<string, string> = {
  passed: '#2ea043',
  failed: '#f85149',
  timedOut: '#f85149',
  interrupted: '#f85149',
  skipped: '#d29922',
};
function HistoryDots() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  const slots = Array.from({ length: HISTORY_SLOTS }, (_, i) => r.history[i] ?? null);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {slots.map((h, i) => {
        if (!h) {
          return (
            <Box
              key={i}
              sx={{
                width: 8, height: 8, borderRadius: '50%',
                border: '1px dashed', borderColor: 'divider',
              }}
            />
          );
        }
        const color = HISTORY_COLOR[h.status] ?? '#7d8590';
        const tooltip = `${h.runId} · ${h.status} · ${h.durationMs < 1000 ? Math.round(h.durationMs) + 'ms' : (h.durationMs/1000).toFixed(1) + 's'}`;
        return (
          <Box
            key={i}
            title={tooltip}
            sx={{
              width: 10, height: 10, borderRadius: '50%',
              backgroundColor: color,
              cursor: 'help',
            }}
          />
        );
      })}
    </Stack>
  );
}

function DurationCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  if (r.lastDurationMs == null) return <Typography variant="caption" color="text.secondary">—</Typography>;
  const ms = r.lastDurationMs;
  const text = ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms/1000).toFixed(1)}s` : `${Math.floor(ms/60_000)}m ${Math.round((ms%60_000)/1000)}s`;
  return <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{text}</Typography>;
}

const ListActions = () => (
  <TopToolbar>
    <FilterButton />
  </TopToolbar>
);

export const TestList = () => (
  <List
    filters={TestFilters}
    actions={<ListActions />}
    perPage={50}
    sort={{ field: 'file', order: 'ASC' }}
    sx={{
      '& .RaList-main': { paddingTop: 1 },
      '& .MuiTableCell-head': { fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' },
      '& .MuiTableCell-body': { verticalAlign: 'top', paddingTop: 1, paddingBottom: 1 },
    }}
  >
    <Datagrid
      rowClick="show"
      bulkActionButtons={false}
      sx={{
        '& .column-title': { width: '28%' },
        '& .column-file': { width: '22%' },
        '& .column-tags': { width: '26%' },
        '& .column-history': { width: '8%' },
        '& .column-lastStatus': { width: '8%' },
        '& .column-duration': { width: '8%' },
      }}
    >
      <FunctionField label="Title" source="title" render={() => <TitleCell />} />
      <FunctionField label="File" source="file" render={() => <FileCell />} />
      <FunctionField label="Tags" source="tags" render={() => <TagsCell />} />
      <FunctionField label="Last 5" source="history" render={() => <HistoryDots />} />
      <FunctionField label="Last status" source="lastStatus" render={() => <StatusBadge />} />
      <FunctionField label="Duration" source="duration" render={() => <DurationCell />} />
    </Datagrid>
  </List>
);

// ---------------------------------------------------------------------------
// Show: description, video, source.
// ---------------------------------------------------------------------------

const VideoBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.latestRun?.videoUrl) return null;
  return (
    <Box mt={1.5}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Video</Typography>
      <video src={r.latestRun.videoUrl} controls preload="metadata" style={{ width: '100%', maxHeight: 420, background: 'black', borderRadius: 4 }} />
    </Box>
  );
};

const DescriptionBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.description) return <Typography color="text.secondary" variant="body2">No description.</Typography>;
  // Detect "Steps:" block and render as a numbered list; everything else is paragraphs.
  const blocks = r.description.trim().split(/\n{2,}/);
  return (
    <Box>
      {blocks.map((b, i) => {
        if (/^Steps:\s*$/m.test(b.split('\n')[0])) {
          const items = b.split('\n').slice(1).map(l => l.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
          return (
            <Box key={i} mb={1}>
              <Typography variant="overline" color="text.secondary">Steps:</Typography>
              <Box component="ol" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
                {items.map((s, j) => <li key={j}><Typography variant="body2">{s}</Typography></li>)}
              </Box>
            </Box>
          );
        }
        return <Typography key={i} variant="body2" sx={{ mb: 1, lineHeight: 1.55 }}>{b}</Typography>;
      })}
    </Box>
  );
};

const SourceBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.source) return null;
  return (
    <Box
      component="pre"
      sx={{
        background: '#0d1117', color: '#e6edf3', p: 1.5, borderRadius: 1,
        fontSize: 12, overflow: 'auto', maxHeight: 480,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {r.source}
    </Box>
  );
};

const TagsListShow = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {r.tags.map(t => {
        const m = t.match(/^@([a-z]+):(.+)$/i);
        const facet = m?.[1] ?? 'other';
        const value = m?.[2] ?? t;
        return (
          <Chip key={t} size="small" label={value} color={FACET_CHIP_COLOR[facet] ?? 'default'} variant="outlined" />
        );
      })}
    </Stack>
  );
};

/**
 * Lists every prior run for this test (up to 5, the rolling window). For
 * each entry: status badge, duration, link to that run's standalone
 * Playwright report. The dashboard preserves run dirs on disk for the
 * window length, so each link is always live.
 */
function RunHistoryBlock() {
  const r = useRecordContext<CatalogTest>();
  if (!r || !r.history.length) {
    return <Typography variant="body2" color="text.secondary">No prior runs recorded.</Typography>;
  }
  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      {r.history.map((h, i) => {
        const dur = h.durationMs < 1000 ? `${Math.round(h.durationMs)}ms` : `${(h.durationMs/1000).toFixed(1)}s`;
        const reportLink = `runs/${h.runId}/playwright-report/index.html`;
        // Latest run also has direct video/trace pointers in r.latestRun
        const isLatest = r.latestRun?.runId === h.runId;
        return (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 13 }}>
            <Chip
              size="small"
              label={h.status}
              color={STATUS_COLORS[h.status] ?? 'default'}
              sx={{ minWidth: 76 }}
            />
            <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', flex: '0 0 220px' }}>
              {h.runId}
            </Typography>
            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', flex: '0 0 60px' }}>
              {dur}
            </Typography>
            <Typography variant="caption" component="a"
              href={reportLink}
              target="_blank"
              rel="noopener"
              sx={{ color: 'primary.main', textDecoration: 'underline' }}
            >
              Open report
            </Typography>
            {isLatest && r.latestRun?.videoUrl && (
              <Typography variant="caption" component="a"
                href={r.latestRun.videoUrl}
                target="_blank"
                rel="noopener"
                sx={{ color: 'primary.main', textDecoration: 'underline' }}
              >
                Video
              </Typography>
            )}
            {isLatest && r.latestRun?.traceUrl && (
              <Typography variant="caption" component="a"
                href={r.latestRun.traceUrl}
                target="_blank"
                rel="noopener"
                sx={{ color: 'primary.main', textDecoration: 'underline' }}
              >
                Trace
              </Typography>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

export const TestShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="title" />
      <TextField source="describe" label="Describe" />
      <FunctionField label="Location" render={(r: CatalogTest) => `${r.file}:${r.line}`} />
      <FunctionField label="Tags" render={() => <TagsListShow />} />
      <FunctionField label="Last status" render={() => <StatusBadge />} />
      <FunctionField label="Run history (last 5)" render={() => <RunHistoryBlock />} />
      <FunctionField label="Description" render={() => <DescriptionBlock />} />
      <FunctionField label="Video" render={() => <VideoBlock />} />
      <FunctionField label="Source" render={() => <SourceBlock />} />
    </SimpleShowLayout>
  </Show>
);

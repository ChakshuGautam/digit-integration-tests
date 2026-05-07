import { Layout as RaLayout } from 'react-admin';
import type { ReactNode } from 'react';
import MyAppBar from './MyAppBar';

export default function Layout({ children }: { children: ReactNode }) {
  return <RaLayout appBar={MyAppBar}>{children}</RaLayout>;
}

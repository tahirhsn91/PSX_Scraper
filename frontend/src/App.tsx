import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { SearchResults } from './pages/SearchResults';
import { StockDetails } from './pages/StockDetails';
import { SyncLogs } from './pages/SyncLogs';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/stocks/:symbol" element={<StockDetails />} />
        <Route path="/logs" element={<SyncLogs />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

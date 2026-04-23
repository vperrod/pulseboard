import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { Register } from './components/Register';
import { Admin } from './components/Admin';
import { HRDashboard } from './components/HRDashboard';
import { LiveLeaderboard } from './components/LiveLeaderboard';
import { FullLeaderboard } from './components/FullLeaderboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/register" element={<Register />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/hrdashboard" element={<HRDashboard />} />
        <Route path="/liveleaderboard" element={<LiveLeaderboard />} />
        <Route path="/fullleaderboard" element={<FullLeaderboard />} />
      </Routes>
    </BrowserRouter>
  );
}

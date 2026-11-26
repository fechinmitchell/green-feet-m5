import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Connect from './pages/Connect.jsx';
import Calibrate from './pages/Calibrate.jsx';
import Putt from './pages/Putt.jsx';
import Progress from './pages/Progress.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/admin/Admin.jsx';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/calibrate" element={<Calibrate />} />
        <Route path="/putt" element={<Putt />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Layout>
  );
}

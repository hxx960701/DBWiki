import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/Layout/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import DictionaryBrowser from './pages/DictionaryBrowser';
import VersionHistory from './pages/VersionHistory';
import AdminUsers from './pages/AdminUsers';
import SystemAdmin from './pages/SystemAdmin';
import RoleManagement from './pages/RoleManagement';
import Profile from './pages/Profile';

const App: React.FC = () => {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff', borderRadius: 6 } }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<MainLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/connections/:id/dictionary" element={<DictionaryBrowser />} />
              <Route path="/connections/:id/versions" element={<VersionHistory />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/system" element={<SystemAdmin />} />
              <Route path="/admin/roles" element={<RoleManagement />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;

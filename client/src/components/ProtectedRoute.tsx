import React, { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '../stores/authStore';

const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, loading, fetchProfile } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated && !useAuthStore.getState().user) {
      fetchProfile();
    }
  }, [isAuthenticated, fetchProfile]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin size="large" /></div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;

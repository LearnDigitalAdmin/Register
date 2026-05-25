
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import AuthPage from './pages/AuthPage';
import AppDashboard from './pages/AppDashboard';
import './index.css';
// import PWABanner from './PWABanner';

export default function App() {
  return (
    <BrowserRouter>
    {/* <PWABanner /> */}
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<AuthPage defaultTab="login" />} />
          <Route path="/signup" element={<AuthPage defaultTab="signup" />} />
          <Route path="/app" element={<ProtectedRoute><AppDashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import { AuthProvider } from './context/AuthContext';
import { TechnicianAuthProvider } from './context/TechnicianAuthContext';
import { Toaster } from 'react-hot-toast';
import { appRoutes } from './routes';

function App() {
  return (
    <AuthProvider>
      <TechnicianAuthProvider>
        <Router>
          <Toaster position="top-right" toastOptions={{ className: 'text-sm', duration: 4500 }} />
          <Routes>
            {appRoutes.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
          </Routes>
        </Router>
      </TechnicianAuthProvider>
    </AuthProvider>
  );
}

export default App;

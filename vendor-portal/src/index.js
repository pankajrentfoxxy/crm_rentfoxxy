import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { VendorAuthProvider } from './context/VendorAuthContext';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <VendorAuthProvider>
        <App />
        <Toaster position="top-right" toastOptions={{ duration: 4500 }} />
      </VendorAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

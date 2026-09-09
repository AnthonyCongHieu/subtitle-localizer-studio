import React from 'react';
import ReactDOM from 'react-dom/client';
import { AdminLanView } from './components/admin/AdminLanView';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AdminLanView onBack={() => { window.location.href = '/'; }} /></React.StrictMode>,
);

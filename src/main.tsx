import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
// Design-system tokens + primitive classes. Loaded once, globally, because the
// `:root` custom properties must be available to every inline style in the app
// (KIT.* emits `var(--x)` references). kit.css contains NO element selectors,
// so importing it cannot restyle a screen that has not been migrated yet.
import './ui/kit/kit.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

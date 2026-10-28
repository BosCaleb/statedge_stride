import './lib/zodSetup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppErrorBoundary } from './app/ErrorBoundary';
import { routes } from './app/routes';
import { applyTheme, loadTheme } from './lib/theme';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';

applyTheme(loadTheme());

// Ask the browser to keep this origin's storage (offline data, clips) once the app is installed.
const standalone = window.matchMedia('(display-mode: standalone)').matches;
if (standalone) void navigator.storage?.persist?.();
window.addEventListener('appinstalled', () => void navigator.storage?.persist?.());

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={createBrowserRouter(routes)} />
    </AppErrorBoundary>
  </StrictMode>,
);

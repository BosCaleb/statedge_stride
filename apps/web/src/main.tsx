import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

// M0: only the developer spike page is routed. The application shell replaces this in M1.
const router = createBrowserRouter([
  {
    path: '/dev/spike',
    lazy: async () => ({ Component: (await import('./features/dev/SpikePage')).SpikePage }),
  },
  { path: '*', element: <main /> },
]);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

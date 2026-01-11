import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Dynamic routes that need client-side rendering
  {
    path: 'messages/:conversationId',
    renderMode: RenderMode.Client
  },
  // Catch-all for other routes
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];

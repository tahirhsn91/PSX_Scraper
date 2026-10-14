import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Whether there is an earlier page in *this* history to return to, and a callback that goes there.
 *
 * `window.history.length` is the wrong test: it counts every entry the tab has ever held, so a
 * fresh tab that was deep-linked straight to a bad URL reports a long history and a "Go back"
 * button that lands somewhere unrelated (or does nothing). React Router tags each entry it pushes
 * with an incrementing `idx`, so `idx > 0` means the reader arrived here from inside the app.
 */
export function useGoBack(): { canGoBack: boolean; goBack: () => void } {
  const navigate = useNavigate();
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  const goBack = useCallback(() => navigate(-1), [navigate]);
  return { canGoBack: idx > 0, goBack };
}

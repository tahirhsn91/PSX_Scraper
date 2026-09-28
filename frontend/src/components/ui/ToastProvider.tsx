import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { Alert, AlertColor, Button, Snackbar } from '@mui/material';

export interface ToastOptions {
  message: string;
  severity?: AlertColor;
  /** Optional inline action, e.g. "Undo" or "View". */
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastCtx {
  notify: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastCtx>({ notify: () => {} });

/** Fire-and-forget feedback for mutations. Every action that changes data gets one. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const [open, setOpen] = useState(false);

  const notify = useCallback((next: ToastOptions) => {
    setToast(next);
    setOpen(true);
  }, []);

  const close = () => setOpen(false);
  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={toast?.duration ?? 5000}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        // Clears the mobile bottom navigation.
        sx={{ bottom: { xs: 72, sm: 16 } }}
      >
        <Alert
          severity={toast?.severity ?? 'success'}
          variant="outlined"
          onClose={close}
          sx={{ backgroundColor: 'background.paper', boxShadow: 3, alignItems: 'center' }}
          action={
            toast?.actionLabel ? (
              <Button
                size="small"
                color="inherit"
                onClick={() => {
                  toast.onAction?.();
                  close();
                }}
              >
                {toast.actionLabel}
              </Button>
            ) : undefined
          }
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

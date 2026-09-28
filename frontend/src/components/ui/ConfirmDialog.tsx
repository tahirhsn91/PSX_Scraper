import { ReactNode } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Plain-language explanation of what will happen. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions confirm in the error tone, never as a quiet outline. */
  tone?: 'primary' | 'error' | 'warning';
  /** Disables both buttons and shows the confirm label in progress. */
  pending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

/**
 * The one confirm dialog. Every destructive or expensive action goes through it — the audit found
 * the dashboard's confirm duplicating this markup and the failures panel offering a clear action
 * with no confirmation at all.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  pending = false,
  pendingLabel,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="confirm-dialog-title">
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      <DialogContent>
        {typeof message === 'string' ? <DialogContentText>{message}</DialogContentText> : message}
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} color="inherit">
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm} disabled={pending} variant="contained" color={tone} autoFocus>
          {pending ? (pendingLabel ?? 'Working…') : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

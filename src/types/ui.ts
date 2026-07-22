export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  message: string;
  type: ToastType;
  timestamp: number;
}

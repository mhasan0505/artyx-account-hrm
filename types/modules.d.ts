declare module "sonner" {
  export interface ToastOptions {
    id?: string | number;
    description?: React.ReactNode;
    duration?: number;
    [key: string]: unknown;
  }

  export const toast: {
    (message: string, options?: ToastOptions): string | number;
    success: (message: string, options?: ToastOptions) => string | number;
    error: (message: string, options?: ToastOptions) => string | number;
    warning: (message: string, options?: ToastOptions) => string | number;
    info: (message: string, options?: ToastOptions) => string | number;
    loading: (message: string, options?: ToastOptions) => string | number;
    dismiss: (id?: string | number) => void;
  };

  export function Toaster(props: Record<string, unknown>): JSX.Element;
}

declare module "qrcode.react" {
  export function QRCodeSVG(props: {
    value: string;
    size?: number;
    includeMargin?: boolean;
    level?: "L" | "M" | "Q" | "H";
    className?: string;
  }): JSX.Element;
}

declare module "react-hotkeys-hook" {
  export function useHotkeys(
    keys: string,
    callback: (event: KeyboardEvent) => void,
    options?: Record<string, unknown>,
    deps?: unknown[],
  ): void;
}

import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/** Assemble des classes ; en cas de conflit (ex. w-full / w-40), la dernière gagne. */
export const cx = (...v: ClassValue[]) => twMerge(clsx(v));

type Variant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }
>(function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold whitespace-nowrap",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-2.5 text-sm" : "h-10 px-3.5 text-[0.95rem]",
        variant === "primary" && "bg-pen text-white hover:bg-[#264d70]",
        variant === "secondary" && "bg-sheet text-ink border border-rule hover:border-pen",
        variant === "ghost" && "text-ink-soft hover:text-ink hover:bg-pen-soft",
        variant === "danger" && "text-late hover:bg-late-soft",
        className,
      )}
      {...rest}
    />
  );
});

const field =
  "w-full rounded-md border border-rule bg-sheet px-3 text-ink placeholder:text-ink-soft/70 focus:border-pen focus:outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(field, "h-10", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(field, "py-2 min-h-24", className)} {...rest} />;
  },
);

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(field, "h-10 pr-8", className)} {...rest} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "pen" | "late" | "done";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold",
        tone === "neutral" && "bg-paper text-ink-soft",
        tone === "pen" && "bg-pen-soft text-pen",
        tone === "late" && "bg-late-soft text-late",
        tone === "done" && "bg-[#e3f0e8] text-done",
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-4 py-6 text-ink-soft">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Fenêtre modale native (<dialog>) : accessible au clavier, Échap pour fermer. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-1.5rem)] rounded-lg bg-sheet p-0 text-ink shadow-xl backdrop:bg-ink/30",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <h2>{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer">
              <X className="size-4" />
            </Button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Message bref en bas d'écran. */
let toastHost: ((msg: string, tone?: "ok" | "error") => void) | null = null;
export function toast(msg: string, tone: "ok" | "error" = "ok") {
  toastHost?.(msg, tone);
}
export function registerToastHost(fn: typeof toastHost) {
  toastHost = fn;
}

import { Mic, MicOff } from "lucide-react";
import type { TextareaHTMLAttributes } from "react";
import { useDictation } from "@/lib/use-dictation";
import { Button, Textarea, cx } from "./ui";

/**
 * Zone de texte avec dictée : c'est la praticienne qui parle au micro, comme avec la
 * dictée du téléphone. Rien n'est enregistré, seul le texte reconnu est ajouté.
 */
export function DictationTextarea({
  value,
  onValueChange,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
}) {
  const d = useDictation((text) => {
    onValueChange(value && !/\s$/.test(value) ? `${value} ${text}` : `${value}${text}`);
  });
  return (
    <div>
      <Textarea value={value} onChange={(e) => onValueChange(e.target.value)} className={className} {...rest} />
      {d.supported && (
        <Button
          size="sm"
          variant="ghost"
          className={cx("mt-1", d.listening && "bg-late-soft text-late")}
          onClick={d.listening ? d.stop : d.start}
        >
          {d.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          {d.listening ? "Arrêter la dictée" : "Dicter"}
        </Button>
      )}
    </div>
  );
}

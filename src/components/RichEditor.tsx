import { Color, TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Italic, List, ListOrdered, Mic, MicOff, Underline } from "lucide-react";
import { useEffect } from "react";
import { useDictation } from "@/lib/use-dictation";
import { cx } from "./ui";

/** Couleurs proposées : peu nombreuses, lisibles à l'impression. */
const COLORS = [
  { name: "Encre", value: null },
  { name: "Bleu", value: "#2f5d86" },
  { name: "Rouge", value: "#b3412e" },
  { name: "Vert", value: "#3c7a55" },
  { name: "Violet", value: "#6b4c9a" },
];

export function RichEditor({
  value,
  onChange,
  placeholder = "Écrire ou dicter…",
  autoFocus,
  onEditor,
  minHeight = "12rem",
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEditor?: (e: Editor) => void;
  minHeight?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, code: false, codeBlock: false, link: false, horizontalRule: false }), TextStyle, Color, Placeholder.configure({ placeholder })],
    content: value,
    autofocus: autoFocus ? "end" : false,
    editorProps: { attributes: { class: "prose-note", style: `min-height:${minHeight}` } },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  });

  useEffect(() => {
    if (editor && onEditor) onEditor(editor);
  }, [editor, onEditor]);

  // Contenu remplacé de l'extérieur (ex. mise au propre) : on met l'éditeur à jour.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  const dictation = useDictation((text) => {
    if (!editor) return;
    const needsSpace = !editor.isEmpty && !/\s$/.test(editor.state.doc.textBetween(0, editor.state.selection.from, "\n"));
    editor.chain().focus().insertContent((needsSpace ? " " : "") + text).run();
  });

  if (!editor) return null;
  const tool = (active: boolean) =>
    cx(
      "grid size-9 place-items-center rounded-md text-ink-soft hover:bg-pen-soft hover:text-ink",
      active && "bg-pen-soft text-pen",
    );

  return (
    <div className="rounded-lg border border-rule bg-sheet">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-rule px-1.5 py-1" role="toolbar" aria-label="Mise en forme">
        <button type="button" className={tool(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Gras" title="Gras (Ctrl+B)">
          <Bold className="size-4" />
        </button>
        <button type="button" className={tool(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italique" title="Italique (Ctrl+I)">
          <Italic className="size-4" />
        </button>
        <button type="button" className={tool(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Souligné" title="Souligné (Ctrl+U)">
          <Underline className="size-4" />
        </button>
        <button type="button" className={tool(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Liste à puces">
          <List className="size-4" />
        </button>
        <button type="button" className={tool(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Liste numérotée">
          <ListOrdered className="size-4" />
        </button>
        <span className="mx-1 h-6 w-px bg-rule" />
        {COLORS.map((c) => (
          <button
            key={c.name}
            type="button"
            title={c.name}
            aria-label={`Couleur ${c.name}`}
            className="grid size-9 place-items-center rounded-md hover:bg-pen-soft"
            onClick={() =>
              c.value
                ? editor.chain().focus().setColor(c.value).run()
                : editor.chain().focus().unsetColor().run()
            }
          >
            <span
              className={cx(
                "size-4 rounded-full border border-rule",
                editor.isActive("textStyle", { color: c.value }) && "ring-2 ring-pen ring-offset-1",
              )}
              style={{ background: c.value ?? "var(--color-ink)" }}
            />
          </button>
        ))}
        {dictation.supported && (
          <button
            type="button"
            className={cx(
              "ml-auto flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-ink-soft hover:bg-pen-soft hover:text-ink",
              dictation.listening && "bg-late-soft text-late",
            )}
            onClick={dictation.listening ? dictation.stop : dictation.start}
          >
            {dictation.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            {dictation.listening ? "Arrêter la dictée" : "Dicter"}
          </button>
        )}
      </div>
      <div className="sheet-margin py-3 pr-4 pl-12">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

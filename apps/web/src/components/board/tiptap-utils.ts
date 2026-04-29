import { Extension, InputRule } from "@tiptap/core";

export const MarkdownLinkShortcut = Extension.create({
  name: "markdownLinkShortcut",

  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)(\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))$/,
        handler: ({ state, range, match }) => {
          const linkMark = state.schema.marks.link;
          if (!linkMark) return;

          const fullMatch = match[0];
          const markdownLink = match[1];
          const label = match[2];
          const href = match[3];
          if (!markdownLink || !label || !href) return;

          const linkStart = range.from + fullMatch.lastIndexOf(markdownLink);
          const linkEnd = range.to;
          state.tr
            .insertText(label, linkStart, linkEnd)
            .addMark(linkStart, linkStart + label.length, linkMark.create({ href }))
            .removeStoredMark(linkMark);
        },
      }),
    ];
  },
});

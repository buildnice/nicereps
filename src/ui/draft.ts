export type Draft = { text: string; fresh: boolean };

export const pressKey = ({ text, fresh }: Draft, key: string, decimal: boolean): Draft => {
  const base = fresh ? '' : text;
  if (key === 'del') return { text: base.slice(0, -1), fresh: false };
  if (key === '.') return { text: !decimal || base.includes('.') ? base : `${base || '0'}.`, fresh: false };
  return { text: base === '0' ? key : (base + key).slice(0, 6), fresh: false };
};

export const parse = (text: string) => (text === '' ? undefined : Number(text));

export type Press = { from: Draft; to: Draft; sent: Draft[] };

// Renders can land between presses, so a rendered draft that matches a sent one is still part of the chain.
export const nextPress = (last: Press | undefined, draft: Draft, key: string, decimal: boolean): Press => {
  const i = !last ? -1 : last.from === draft ? 0 : last.sent.findLastIndex((s) => !draft.fresh && s.text === draft.text);
  const sent = i < 0 ? [] : last!.sent.slice(i);
  const to = pressKey(sent.at(-1) ?? draft, key, decimal);
  return { from: draft, to, sent: [...sent, to] };
};

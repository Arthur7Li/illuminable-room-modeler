// SequenceGraphConfig: one row in the Desmos-style multi-sequence list.
//
// Each row is one complete unfolding configuration (a bounce-code sequence
// plus its own Angle Step and display color) and, when visible, one plotted
// dataset in the shared "Valid Angle A-B Region" graph. `id` is a stable
// identity that survives edits/reordering/renaming; `label` is the display
// name shown in the UI and legend. Keeping them separate means a row's
// identity (used for React keys, cached results, and per-point source
// attribution) never has to change just because its label or contents did.
//
// Deliberately NOT stored on this model: the parsed sequence, generated
// graph points, or render status. Those all depend on the shared base
// triangle (Angle A/B/Length, common to every row) and on live generation
// state, so they live as ephemeral, id-keyed state inside AnglePlotWindow
// (which already owns exactly this kind of cancellable/cacheable job state
// for the single-sequence case) rather than being duplicated onto this
// config object. This keeps SequenceGraphConfig a plain, serializable
// description of "what the user asked for", not a cache.

// Named, accessible colors with enough contrast against both the light and
// dark canvas backgrounds this app already supports (see THEME_PALETTES in
// App.jsx). Assigned in this fixed order so a sequence's color never
// depends on how many other rows currently exist.
export const SEQUENCE_COLOR_PALETTE = [
  { name: 'blue', hex: '#0284c7' },
  { name: 'orange', hex: '#d97706' },
  { name: 'green', hex: '#059669' },
  { name: 'purple', hex: '#7c3aed' },
  { name: 'red', hex: '#dc2626' },
  { name: 'teal', hex: '#0891b2' },
  { name: 'magenta', hex: '#db2777' },
  { name: 'gold', hex: '#b45309' },
];

/** Returns the palette color for the Nth sequence ever created (0-indexed), cycling if exhausted. */
export const colorForSequenceNumber = (number) => (
  SEQUENCE_COLOR_PALETTE[(number - 1) % SEQUENCE_COLOR_PALETTE.length].hex
);

/**
 * Builds a new sequence row. `number` is the monotonically increasing
 * creation index (never reused, even after earlier rows are deleted) — it
 * drives both the default label ("Graph N") and the stable color
 * assignment, so neither shifts when unrelated rows are removed.
 */
export const createSequenceRow = ({ number, sequenceText = '', angleStepInput = '0.1' }) => ({
  id: `seq-${number}`,
  label: `Graph ${number}`,
  sequenceText,
  angleStepInput,
  color: colorForSequenceNumber(number),
  visible: true,
});

/** Truncates a sequence string for compact legend/row display, keeping the full text available via title/tooltip. */
export const truncateSequenceText = (text, maxLength = 28) => {
  const trimmed = (text || '').trim();
  if (trimmed.length <= maxLength) return trimmed || '(empty)';
  return `${trimmed.slice(0, maxLength - 1)}…`;
};

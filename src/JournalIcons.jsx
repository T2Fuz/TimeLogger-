// JournalIcons.jsx — small self-contained SVG icons for the Journal.
// Deliberately NOT imported from lucide-react: every icon name imported from
// a package must exist in the installed version or the production build
// fails, and these few shapes are not worth that risk.

function Ico({ size = 18, children, className = "", fill = "none", strokeWidth = 2 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" focusable="false"
    >
      {children}
    </svg>
  );
}

export const UndoIcon = (p) => <Ico {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Ico>;
export const RedoIcon = (p) => <Ico {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Ico>;
export const LinkIcon = (p) => <Ico {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Ico>;
export const ImageIcon = (p) => <Ico {...p}><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></Ico>;
export const MicIcon = (p) => <Ico {...p}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></Ico>;
export const SearchIcon = (p) => <Ico {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Ico>;
export const BulletsIcon = (p) => <Ico {...p}><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></Ico>;
export const NumbersIcon = (p) => <Ico {...p}><path d="M10 6h11M10 12h11M10 18h11" /><path d="M4 5.5 5.2 5v4M3.6 14.2c.4-.7 2.4-.9 2.4.4 0 1-1.6 1.4-2.4 2.4H6M3.6 19.5h2.2l-1 1.3c.8 0 1.4.4 1.4 1.1 0 .9-1.2 1.3-2.6.7" strokeWidth="1.4" /></Ico>;
export const ChecklistIcon = (p) => <Ico {...p}><rect x="3" y="4" width="6" height="6" rx="1.2" /><path d="m4.4 7 1.2 1.2L7.8 6" /><rect x="3" y="14" width="6" height="6" rx="1.2" /><path d="M13 7h8M13 17h8" /></Ico>;
export const IndentIcon = (p) => <Ico {...p}><path d="M3 6h18M12 12h9M12 18h9" /><path d="m3 9 3 3-3 3" /></Ico>;
export const OutdentIcon = (p) => <Ico {...p}><path d="M3 6h18M12 12h9M12 18h9" /><path d="m6 9-3 3 3 3" /></Ico>;
export const AlignLeftIcon = (p) => <Ico {...p}><path d="M3 6h18M3 12h12M3 18h16" /></Ico>;
export const AlignCenterIcon = (p) => <Ico {...p}><path d="M3 6h18M6 12h12M5 18h14" /></Ico>;
export const AlignRightIcon = (p) => <Ico {...p}><path d="M3 6h18M9 12h12M5 18h16" /></Ico>;
export const HighlighterIcon = (p) => <Ico {...p}><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></Ico>;
export const MoreIcon = (p) => <Ico {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></Ico>;
export const StopIcon = (p) => <Ico {...p} fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></Ico>;
export const SaveIcon = (p) => <Ico {...p}><path d="m5 12 5 5L20 7" /></Ico>;
export const BookIcon = (p) => <Ico {...p}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></Ico>;
export const RestoreIcon = (p) => <Ico {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Ico>;

export type Mode = "select" | "walls" | "scale" | "arrange" | "comment";

interface ToolRailProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  help: Record<Mode, string>;
}

const ICONS: Record<Mode, React.ReactNode> = {
  select: (
    <>
      <path d="M5 3l12 8-5.2 1.4L9.6 18z" />
    </>
  ),
  walls: (
    <>
      <path d="M3 17L9 7l4 6 5-9" />
      <circle cx="3" cy="17" r="1.5" />
      <circle cx="9" cy="7" r="1.5" />
      <circle cx="13" cy="13" r="1.5" />
      <circle cx="18" cy="4" r="1.5" />
    </>
  ),
  scale: (
    <>
      <rect x="2.5" y="8" width="17" height="6" rx="1" />
      <path d="M6.5 8v3M10 8v4M13.5 8v3M17 8v4" />
    </>
  ),
  arrange: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="11" y="11" width="8" height="8" rx="1" />
      <path d="M12 6h6M15 3l3 3-3 3" />
    </>
  ),
  comment: (
    <>
      <path d="M3 5.5A1.5 1.5 0 014.5 4h13A1.5 1.5 0 0119 5.5v8a1.5 1.5 0 01-1.5 1.5H8l-5 4z" />
    </>
  ),
};

const LABELS: Record<Mode, string> = {
  select: "Select",
  walls: "Walls",
  scale: "Scale",
  arrange: "Arrange",
  comment: "Comment",
};

const ORDER: Mode[] = ["select", "walls", "scale", "arrange", "comment"];

export default function ToolRail({ mode, onModeChange, help }: ToolRailProps) {
  return (
    <nav className="tool-rail">
      {ORDER.map((m) => (
        <button
          key={m}
          className={mode === m ? "tool-rail__btn tool-rail__btn--active" : "tool-rail__btn"}
          onClick={() => onModeChange(m)}
          title={help[m]}
        >
          <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[m]}
          </svg>
          <span>{LABELS[m]}</span>
        </button>
      ))}
    </nav>
  );
}

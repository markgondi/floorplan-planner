import mqLogo from "../assets/mq-logo.png";

interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export default function Header({ theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <div className="app-header__logo-slot">
          <img src={mqLogo} alt="Macquarie University" />
        </div>
        <span className="app-header__divider" />
        <span className="app-header__title mono">FLOORPLAN PLANNER</span>
      </div>
      <button className="app-header__theme-toggle" onClick={onToggleTheme}>
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>
    </header>
  );
}

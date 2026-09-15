import mqLogo from "../assets/mq-shield.png";

interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  roomName?: string | null;
  folderName?: string | null;
}

export default function Header({ theme, onToggleTheme, roomName, folderName }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <img className="app-header__logo" src={mqLogo} alt="Macquarie University" />
        <span className="app-header__wordmark mono">Floorplan Planner</span>
      </div>

      {roomName && (
        <div className="app-header__crumbs mono">
          {folderName && (
            <>
              <span className="app-header__crumb-dim">{folderName}</span>
              <span className="app-header__crumb-sep">/</span>
            </>
          )}
          <span className="app-header__crumb">{roomName}</span>
        </div>
      )}

      <button className="app-header__theme" onClick={onToggleTheme} title="Switch theme">
        {theme === "light" ? "Dark" : "Light"}
      </button>
    </header>
  );
}

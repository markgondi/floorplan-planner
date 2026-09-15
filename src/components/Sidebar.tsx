import type { ReactNode } from "react";

interface SidebarProps {
  side: "left" | "right";
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  tabs?: { id: string; label: string; badge?: number }[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
}

export default function Sidebar({ side, title, collapsed, onToggle, children, tabs, activeTab, onTabChange }: SidebarProps) {
  if (collapsed) {
    return (
      <div className={`sidebar sidebar--${side} sidebar--collapsed`}>
        <button className="sidebar__rail-toggle" onClick={onToggle} title={`Show ${title}`}>
          <span className="sidebar__rail-label">{title}</span>
        </button>
      </div>
    );
  }

  return (
    <aside className={`sidebar sidebar--${side}`}>
      <header className="sidebar__header">
        <span className="sidebar__title mono">{title}</span>
        <button className="sidebar__collapse" onClick={onToggle} title={`Hide ${title}`}>
          {side === "left" ? "‹" : "›"}
        </button>
      </header>

      {tabs && tabs.length > 0 && (
        <div className="sidebar__tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={activeTab === t.id ? "sidebar__tab sidebar__tab--active" : "sidebar__tab"}
              onClick={() => onTabChange?.(t.id)}
            >
              {t.label}
              {t.badge ? <span className="sidebar__badge">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      )}

      <div className="sidebar__body">{children}</div>
    </aside>
  );
}

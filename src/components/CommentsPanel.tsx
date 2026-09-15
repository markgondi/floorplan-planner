import type { Comment } from "../lib/types";

interface CommentsPanelProps {
  comments: Comment[];
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
}

export default function CommentsPanel({ comments, onResolve, onDelete }: CommentsPanelProps) {
  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);

  return (
    <div className="comments-panel">
      <ul className="comments-panel__list">
        {open.map((c, i) => (
          <li key={c.id} className="comments-panel__item">
            <div className="comments-panel__item-header">
              <span className="mono">#{i + 1}</span>
              {c.author && <span className="comments-panel__author">{c.author}</span>}
            </div>
            <p>{c.text}</p>
            <div className="comments-panel__actions">
              <button onClick={() => onResolve(c.id, true)}>Resolve</button>
              <button onClick={() => onDelete(c.id)}>Delete</button>
            </div>
          </li>
        ))}
        {open.length === 0 && <li className="comments-panel__empty">No open comments</li>}
      </ul>

      {resolved.length > 0 && (
        <>
          <div className="furniture-panel__section-label mono">RESOLVED</div>
          <ul className="comments-panel__list">
            {resolved.map((c, i) => (
              <li key={c.id} className="comments-panel__item comments-panel__item--resolved">
                <div className="comments-panel__item-header">
                  <span className="mono">#{open.length + i + 1}</span>
                  {c.author && <span className="comments-panel__author">{c.author}</span>}
                </div>
                <p>{c.text}</p>
                <div className="comments-panel__actions">
                  <button onClick={() => onResolve(c.id, false)}>Reopen</button>
                  <button onClick={() => onDelete(c.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

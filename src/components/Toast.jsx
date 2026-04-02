export default function Toast({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="toast" onClick={onDismiss}>
      {message}
    </div>
  );
}

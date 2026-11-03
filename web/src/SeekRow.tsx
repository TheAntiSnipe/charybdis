import { formatTime } from './Library';
import { usePlayer } from './player';

export default function SeekRow({ className }: { className: string }) {
  const { position, duration, seek } = usePlayer();
  const max = duration || 0;
  const pct = max ? Math.min(100, (position / max) * 100) : 0;
  return (
    <div className={className}>
      <span className="time">{formatTime(position)}</span>
      <input
        className="seek"
        type="range"
        aria-label="Seek"
        min={0}
        max={max}
        step={1}
        value={Math.min(position, max)}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="time">{formatTime(duration)}</span>
    </div>
  );
}

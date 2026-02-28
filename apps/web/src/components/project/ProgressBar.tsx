type ProgressBarProps = {
  done: number;
  total: number;
  color?: string;
};

export function ProgressBar(props: ProgressBarProps) {
  const safeTotal = Math.max(props.total, 0);
  const safeDone = Math.min(Math.max(props.done, 0), safeTotal || 0);
  const ratio = safeTotal > 0 ? safeDone / safeTotal : 0;

  return (
    <>
      <div class="progress-bar-wrap">
        <div class="progress-bar-label">{safeDone + "/" + safeTotal} tasks</div>
        <div class="progress-bar-track" aria-label="Task progress">
          <div
            class="progress-bar-fill"
            style={{
              width: `${ratio * 100}%`,
              "background-color": props.color ?? "#53b97c",
            }}
          />
        </div>
      </div>
      <style>{`
        .progress-bar-wrap {
          display: grid;
          gap: 8px;
        }

        .progress-bar-label {
          color: #a1a1aa;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        .progress-bar-track {
          height: 8px;
          border-radius: 999px;
          background: #1c2430;
          border: 1px solid #2a3240;
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 0.2s ease;
        }
      `}</style>
    </>
  );
}

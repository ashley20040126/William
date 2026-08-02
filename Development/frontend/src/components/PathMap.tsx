import { useNavigate } from 'react-router-dom';
import { ProgressBar } from '@/components/ui';
import type { PathDef } from '@/services/journeyApi';

interface Props {
  path: PathDef;
  pathIndex: number;
  currentStep: number;
}

export default function PathMap({ path, pathIndex, currentStep }: Props) {
  const nav = useNavigate();

  return (
    <div className="rounded-3xl bg-white/96 border border-[rgba(80,70,160,0.08)] shadow-card overflow-hidden">
      {/* Path header */}
      <div
        className="h-1.5"
        style={{ background: `linear-gradient(to right, ${path.gradient[0]}, ${path.gradient[1]})` }}
      />
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <span className="text-[36px] leading-none">{path.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-4">当前旅程</p>
            <p className="text-[18px] font-black text-ink mt-0.5 leading-tight">{path.title}</p>
          </div>
        </div>
        <ProgressBar
          pct={Math.round((currentStep / path.parts) * 100)}
          gradient={path.gradient}
          trackColor="rgba(80,70,160,0.08)"
          className="mt-3"
        />
        <p className="text-[12px] text-ink-4 mt-1.5">
          第 {Math.min(currentStep + 1, path.parts)}/{path.parts} 章
        </p>
      </div>

      {/* Node map */}
      <div className="relative px-4 pb-4 mt-2">
        {path.steps.map((step: { t: string; p: string }, index: number) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const isLocked = index > currentStep;

          return (
            <div key={index} className="relative">
              {/* Connector line (except after last) */}
              {index < path.steps.length - 1 && (
                <div
                  className="absolute left-[18px] top-[36px] w-0.5 h-8"
                  style={{
                    background: isCompleted
                      ? `linear-gradient(to bottom, ${path.gradient[0]}, ${path.gradient[1]})`
                      : 'rgba(80,70,160,0.1)',
                  }}
                />
              )}

              <button
                onClick={() => !isLocked && nav(`/path/${pathIndex}`)}
                disabled={isLocked}
                className={`relative z-10 flex items-center gap-3 w-full rounded-2xl px-3 py-2.5 mb-0.5 text-left transition-all ${
                  isCurrent
                    ? 'bg-[rgba(80,70,160,0.06)] border border-[rgba(80,70,160,0.18)]'
                    : isCompleted
                      ? 'opacity-70'
                      : 'opacity-35'
                }`}
              >
                {/* Node circle */}
                <div
                  className={`flex-none w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-black transition-all ${
                    isCurrent
                      ? 'text-white shadow-md animate-pulse-soft'
                      : isCompleted
                        ? 'text-white'
                        : 'bg-[rgba(80,70,160,0.08)] text-ink-4'
                  }`}
                  style={
                    isCompleted || isCurrent
                      ? { background: `linear-gradient(135deg, ${path.gradient[0]}, ${path.gradient[1]})` }
                      : undefined
                  }
                >
                  {isCompleted ? '✓' : index + 1}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold leading-snug ${isCurrent ? 'text-ink' : 'text-ink-2'}`}>
                    {step.t}
                  </p>
                  {(isCurrent || isCompleted) && (
                    <p className="text-[11px] text-ink-4 mt-0.5 truncate">{step.p}</p>
                  )}
                </div>

                {isCurrent && (
                  <span
                    className="flex-none rounded-full px-2.5 py-1 text-[10px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${path.gradient[0]}, ${path.gradient[1]})` }}
                  >
                    继续 →
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

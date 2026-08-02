import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, ProgressBar, SectionLabel } from '@/components/ui';
import { useStore } from '@/services/store';
import { useI18n } from '@/i18n/useI18n';

export default function PathDetailScreen() {
  const { pathId } = useParams();
  const nav = useNavigate();
  const { tx } = useI18n();
  const feed = useStore((s) => s.todayFeed);
  const journey = (feed?.monthlyPaths || []).find((item) => item.id === pathId);

  if (!journey) {
    return (
      <div className="h-full flex items-center justify-center bg-bg px-5">
        <Card className="p-5 w-full max-w-[360px]">
          <p className="text-[16px] font-bold text-ink">{tx('Path not found')}</p>
          <p className="text-[13px] text-ink-3 mt-2 leading-relaxed">
            {tx("Reload Today first so the current month's recovery plan can be fetched again.")}
          </p>
          <Button full className="mt-4" onClick={() => nav('/')}>{tx('Back to Today')}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col max-w-[430px] mx-auto bg-bg">
      <div
        className="flex-shrink-0 px-5 pb-5 text-white"
        style={{
          paddingTop: 'max(env(safe-area-inset-top,8px), 20px)',
          background: `linear-gradient(160deg, ${journey.gradient[0]}, ${journey.gradient[1]})`,
        }}
      >
        <button
          onClick={() => nav(-1)}
          className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white border-none cursor-pointer"
        >
          ←
        </button>
        <div className="mt-5">
          <p className="text-[32px]">{journey.icon}</p>
          <h1 className="text-heading text-[26px] mt-2">{tx(journey.title)}</h1>
          <p className="text-[13px] text-white/82 mt-2 leading-relaxed">{tx(journey.summary)}</p>
          <div className="flex items-center gap-2 flex-wrap mt-4">
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/18 text-white/90">
              {tx('Main stressor: {stressor}', { stressor: tx(journey.stressSource) })}
            </span>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/18 text-white/90">
              {tx('Badge: {badge}', { badge: tx(journey.badgeLabel) })}
            </span>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-semibold text-white/82 mb-2">
              <span>{tx("This month's progress")}</span>
              <span>{journey.progress.completed}/{journey.progress.total}</span>
            </div>
            <ProgressBar pct={journey.progress.total > 0 ? (journey.progress.completed / journey.progress.total) * 100 : 0} gradient={journey.gradient} trackColor="rgba(255,255,255,0.22)" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-area px-4 py-4 pb-10">
        <Card className="p-4">
          <SectionLabel>{tx('Monthly plan')}</SectionLabel>
          <p className="text-[14px] font-semibold text-ink mt-2">{tx('This path breaks one recovery theme into small daily steps.')}</p>
          <p className="text-[12px] text-ink-3 mt-2 leading-relaxed">
            {tx('Today screen only shows the tasks scheduled for the day. This page keeps the full monthly sequence visible so the user can see why each task exists.')}
          </p>
        </Card>

        <div className="mt-4 space-y-3">
          {journey.tasks.map((task, index) => {
            const completed = task.status === 'completed';
            return (
              <Card key={task.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${completed ? 'bg-teal text-white' : 'bg-bg-2 text-ink-3'}`}>
                    {completed ? '✓' : index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-[14px] font-bold ${completed ? 'text-ink-3 line-through' : 'text-ink'}`}>{tx(task.title)}</p>
                      {task.taskDate && (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-bg-2 text-ink-4">{task.taskDate}</span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-3 mt-1 leading-relaxed">{tx(task.description)}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(80,70,160,0.08)] text-ink-3">{tx(task.type)}</span>
                      {completed && (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(58,136,128,0.08)] text-teal">{tx('Completed')}</span>
                      )}
                    </div>
                    {task.actionPrompt && !completed && (
                      <Button
                        variant="dark"
                        className="mt-3 py-2.5 px-4 text-[12px]"
                        onClick={() => nav('/chat', {
                          state: {
                            assistantPrompt: task.actionPrompt,
                            source: 'monthly_journey_task',
                            nonce: Date.now(),
                          },
                        })}
                      >
                        {tx('Do this with William')}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

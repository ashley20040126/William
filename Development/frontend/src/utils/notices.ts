import type { Insight } from '@/services/store';
import type { TodayFeed } from '@/services/store';

export type TodayNotice = {
  id: string;
  text: string;
  source: 'voice' | 'insight' | 'ambient' | 'trigger';
  severity?: 'warning' | 'positive' | 'neutral';
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function resolveTodayNotice({
  dateKey,
  voiceInsight,
  insight,
  dayHasAmbient,
  ambientStressAvg,
  topTrigger,
  tx,
}: {
  dateKey: string;
  voiceInsight: TodayFeed['voiceInsight'];
  insight: Insight | null;
  dayHasAmbient: boolean;
  ambientStressAvg: number | null;
  topTrigger: string | null;
  tx: Translate;
}): TodayNotice | null {
  if (voiceInsight && voiceInsight.sampleCount > 0) {
    return {
      id: `voice:${dateKey}:${voiceInsight.highStressWindowCount}:${voiceInsight.stabilityDirection}:${voiceInsight.speakingStyle}`,
      text: voiceInsight.customNoticeText || buildVoiceInsightNotice(voiceInsight, tx),
      source: 'voice',
      severity: voiceInsight.severity,
    };
  }

  if (insight) {
    return {
      id: `insight:${dateKey}:${insight.type}:${insight.title}:${insight.detail}`,
      text: `${insight.title}. ${insight.detail}`,
      source: 'insight',
      severity: insight.type,
    };
  }

  if (dayHasAmbient && ambientStressAvg != null) {
    const stressed = ambientStressAvg >= 6.5;
    return {
      id: `ambient:${dateKey}:${stressed ? 'tight' : 'steady'}`,
      text: stressed
        ? tx('Your voice has sounded tighter today. Want to check what is loading you up?')
        : tx('Your voice has sounded steadier today. Want to put words to what is helping?'),
      source: 'ambient',
      severity: stressed ? 'warning' : 'positive',
    };
  }

  if (topTrigger) {
    return {
      id: `trigger:${dateKey}:${topTrigger}`,
      text: tx('"{trigger}" keeps showing up. Want to unpack it?', { trigger: topTrigger }),
      source: 'trigger',
      severity: 'neutral',
    };
  }

  return null;
}

function buildVoiceInsightNotice(
  voiceInsight: NonNullable<TodayFeed['voiceInsight']>,
  tx: Translate
) {
  const timeList = voiceInsight.highStressWindows.slice(0, 3).join(tx(' and '));

  if (voiceInsight.highStressWindowCount > 0 && voiceInsight.stabilityDirection === 'lower') {
    return tx('Today you had {count} high-pressure windows, near {times}. Your voice stability was lower than yesterday.', {
      count: voiceInsight.highStressWindowCount,
      times: timeList || tx('later in the day'),
    });
  }

  if (voiceInsight.highStressWindowCount > 0) {
    return tx('Today you had {count} high-pressure windows, near {times}. William folded those voice signals into your day portrait.', {
      count: voiceInsight.highStressWindowCount,
      times: timeList || tx('later in the day'),
    });
  }

  if (voiceInsight.stabilityDirection === 'lower') {
    return tx('Your voice stability was lower than yesterday, and William picked up a tighter rhythm across the day.');
  }

  if (voiceInsight.speakingStyle === 'quiet') {
    return tx('You spoke less than usual today. William still kept listening for the quieter parts of your day.');
  }

  if (voiceInsight.speakingStyle === 'talkative') {
    return tx('You spent a long time in conversation today. William captured the emotional rhythm behind those exchanges.');
  }

  return tx('William quietly tracked the emotional rhythm in your voice today and added it to your day portrait.');
}

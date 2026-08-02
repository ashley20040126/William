-- ═══════════════════════════════════════════════════════════════
-- William Seeds — static content data (journey paths + practices)
-- Run once after schema.sql, or re-run safely (INSERT IGNORE).
-- ═══════════════════════════════════════════════════════════════

USE william_app;

-- ── Journey paths ─────────────────────────────────────────────

INSERT IGNORE INTO journey_paths (id, title, parts, icon, gradient, steps, sort_order) VALUES
('anxiety', 'Understanding Anxiety', 7, '🧠',
  '["#8B7FCC","#C4527A"]',
  '[{"t":"What is this feeling, really?","p":"When has anxiety been loudest?"},{"t":"Your body knows first","p":"Where do you feel it physically?"},{"t":"The story your mind tells","p":"What thoughts show up?"},{"t":"When it protects you","p":"What is it guarding?"},{"t":"Your specific triggers","p":"What situations set it off?"},{"t":"Building your toolkit","p":"A toolkit that fits you."},{"t":"Integration","p":"What has shifted?"}]',
  0),

('sleep', 'Better Sleep', 6, '🌙',
  '["#2D1B69","#7C3AED"]',
  '[{"t":"How sleep works for you","p":"Falling asleep, staying asleep."},{"t":"What is in your way","p":"Stress, screens, timing?"},{"t":"Your wind-down window","p":"90 minutes before sleep."},{"t":"Your sleep environment","p":"Temperature, light, phone."},{"t":"Your sleep protocol","p":"Based on your patterns."},{"t":"Tracking progress","p":"How will you know?"}]',
  1),

('focus', 'Finding Focus', 6, '🎯',
  '["#0F7A6D","#2DD4BF"]',
  '[{"t":"Where attention goes","p":"What pulls it most?"},{"t":"Your distraction signature","p":"Phone, thoughts, environment?"},{"t":"Energy and focus cycles","p":"When are you sharpest?"},{"t":"Environment audit","p":"What works against you?"},{"t":"Your focus protocol","p":"What actually works?"},{"t":"Protecting deep work","p":"How to hold the boundary."}]',
  2),

('confidence', 'Quiet Confidence', 7, '💪',
  '["#B45309","#D97706"]',
  '[{"t":"Where confidence lives","p":"Where do you feel least sure?"},{"t":"The inner critic","p":"What does it say?"},{"t":"Hidden evidence","p":"When did you handle hard things?"},{"t":"The comparison trap","p":"Who are you measuring against?"},{"t":"Small acts of courage","p":"What do you keep not doing?"},{"t":"Your authentic voice","p":"Inhabiting confidence."},{"t":"Integration","p":"What has changed?"}]',
  3),

('relationships', 'Better Relationships', 6, '💕',
  '["#BE185D","#EC4899"]',
  '[{"t":"Patterns you carry","p":"What repeats?"},{"t":"Needs vs asks","p":"What do you genuinely need?"},{"t":"How you handle conflict","p":"Avoid, escalate, engage?"},{"t":"Unspoken conversations","p":"What needs saying?"},{"t":"Boundaries","p":"Values vs fear."},{"t":"Deeper connection","p":"What would safety feel like?"}]',
  4),

('mood', 'Lifting Your Mood', 6, '🌤️',
  '["#065F46","#10B981"]',
  '[{"t":"What brings you down","p":"What weighs on you?"},{"t":"Mood and your body","p":"Sleep, food, movement, sunlight."},{"t":"Stories you tell yourself","p":"What keeps circling?"},{"t":"What genuinely lifts you","p":"Not should — actually does."},{"t":"Social energy","p":"How is your social world?"},{"t":"Your mood protocol","p":"Early warning system."}]',
  5);

-- ── Monthly recovery path templates ──────────────────────────

INSERT IGNORE INTO recovery_path_templates (id, badge_id, title, summary, default_tasks, icon, gradient, sort_order) VALUES
('conflict_reset', 'badge_conflict_reset', 'Repairing a Frayed Relationship',
  'When conflict lingers in the body, recovery works better as small repair attempts instead of one big confrontation.',
  '[{"title":"Name what still hurts","description":"Write down the part of the conflict that still keeps replaying.","kind":"journal","actionPrompt":"Help me unpack the conflict that is still replaying in my mind.","dayOffset":0},{"title":"Draft one honest message","description":"Write a short message that names your feeling without escalating the situation.","kind":"outreach","actionPrompt":"Help me draft a calm reconciliation message.","dayOffset":2},{"title":"Notice your body before contact","description":"Take two minutes to check whether your body feels ready before reaching out.","kind":"somatic","actionPrompt":"Guide me through a short grounding exercise before I reach out to someone.","dayOffset":5}]',
  '🫶', '["#D46A6A","#F1B28F"]', 0),
('burnout_boundary', 'badge_boundary_builder', 'Rebuilding Boundaries Around Pressure',
  'This path focuses on reducing overload by putting recovery between demanding blocks instead of waiting for collapse.',
  '[{"title":"Spot the loudest pressure point","description":"Identify which part of your day is draining the most energy right now.","kind":"reflection","actionPrompt":"Help me identify the main source of pressure in my day.","dayOffset":0},{"title":"Protect one recovery window","description":"Reserve a short buffer between two demanding events.","kind":"schedule","actionPrompt":"Help me design a 15-minute recovery buffer between two stressful commitments.","dayOffset":1},{"title":"Practice one kind no","description":"Write one sentence you can use to protect your bandwidth this week.","kind":"boundary","actionPrompt":"Help me phrase a kind but clear boundary.","dayOffset":4}]',
  '🛡️', '["#5873B8","#8EC5FC"]', 1),
('grief_stabilizer', 'badge_gentle_return', 'Gentle Return After a Major Loss',
  'When life is disrupted by a breakup or another major loss, recovery starts with small stabilizing rituals and safe reflection.',
  '[{"title":"Make room for the loss","description":"Spend five minutes naming what changed and what still aches.","kind":"reflection","actionPrompt":"Stay with me while I talk through a recent loss.","dayOffset":0},{"title":"Do one grounding action","description":"Choose one physical action that helps your nervous system come down.","kind":"somatic","actionPrompt":"Guide me through a gentle grounding reset.","dayOffset":2},{"title":"Reconnect with one safe person","description":"Send one message to someone who feels emotionally safe.","kind":"outreach","actionPrompt":"Help me write a simple message asking for connection.","dayOffset":6}]',
  '🌱', '["#4C7D6B","#9ED9C5"]', 2),
('social_reentry', 'badge_connection_rebuilder', 'Re-entering Supportive Connection',
  'This path turns isolation into gradual reconnection with people, places, and conversations that feel steadying.',
  '[{"title":"Map your safe people","description":"List the people who usually leave you feeling more grounded, not more depleted.","kind":"mapping","actionPrompt":"Help me identify who feels safe and supportive in my life.","dayOffset":0},{"title":"Send one low-pressure check-in","description":"Reach out with a message that does not demand a big conversation.","kind":"outreach","actionPrompt":"Help me write a low-pressure check-in message to a friend.","dayOffset":3},{"title":"Plan one in-person reset","description":"Schedule one walk, tea, or low-stakes meetup with someone supportive.","kind":"schedule","actionPrompt":"Help me plan a small in-person reset with someone supportive.","dayOffset":7}]',
  '🌤️', '["#E3986D","#F5D0A9"]', 3),
('self_trust', 'badge_self_trust', 'Rebuilding Self-Trust Under Stress',
  'This path helps the user keep small promises to themselves so pressure does not keep eroding confidence.',
  '[{"title":"Pick one promise you can keep","description":"Choose one very small action you can realistically follow through on today.","kind":"commitment","actionPrompt":"Help me pick one small promise I can keep today.","dayOffset":0},{"title":"Complete one guided check-in","description":"Use AI to talk through what almost pulled you off track.","kind":"ai_dialogue","actionPrompt":"I want a deeper check-in about what keeps breaking my self-trust.","dayOffset":2},{"title":"Record evidence of follow-through","description":"Capture one concrete example that shows you did what you said you would do.","kind":"reflection","actionPrompt":"Help me reflect on one small promise I kept.","dayOffset":5}]',
  '🧭', '["#7B61C9","#D6A6FF"]', 4);

-- ── Practices ─────────────────────────────────────────────────

INSERT IGNORE INTO practices (id, slot, icon, name, description, type, mins, sort_order) VALUES
('anchor',   'morning', '⚓', 'Morning Anchor',
  '3 slow breaths. Say: "Today I focus on ___."', 'Reflection', 3, 0),
('breath',   'morning', '🫁', 'Box Breathing',
  'In 4, hold 4, out 4, hold 4. Repeat 4 rounds.',  'Breathwork', 4, 1),

('reset',    'midday',  '💨', 'Midday Reset',
  'Stand. Inhale 4, exhale 6. Repeat 5x.',           'Breathwork', 2, 0),
('scan',     'midday',  '🌊', 'Body Scan',
  'Toes to head. Breathe into tension.',              'Somatic',    3, 1),

('wind',     'evening', '🌙', 'Wind-Down',
  'Inhale 4, hold 4, exhale 8. Get heavy.',          'Meditation', 8, 0),
('breath478','evening', '😮‍💨', '4-7-8 Breathing',
  'In 4. Hold 7. Out 8. Repeat 4.',                  'Breathwork', 3, 1);

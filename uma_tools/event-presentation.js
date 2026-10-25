'use strict';

function unique(rows, key) {
  return [...new Map(rows.map(row => [key(row), row])).values()];
}

function unitLabel(label) {
  return String(label || '').replace(/\bday\s*(\d+)/ig, 'DAY$1').replace(/第(\d+)[场部]/g, '第$1回');
}

// The source events remain intact. Directory aggregation is a projection,
// while every former source URL resolves to its actual child unit.
function projectEvents(events, groups = []) {
  const rawById = new Map(events.map(event => [event.id, event]));
  const byId = new Map(rawById);
  const parentForChild = new Map();
  const hidden = new Set();
  const parents = [];
  for (const group of groups) {
    if (!['competition', 'series_arc', 'onsite_group', 'release_event', 'screening', 'recording_event', 'festival_program', 'online_series'].includes(group.kind)) continue;
    const members = (group.members || group.children || []).map(member => ({ ...member, event: rawById.get(member.event_id || member.id) })).filter(member => member.event);
    const children = members.filter(member => member.role !== 'overview');
    if (children.length < 2 || children.some(member => parentForChild.has(member.event.id))) continue;
    children.sort((a,b) => String(a.event.date || '').localeCompare(String(b.event.date || '')) || String(a.event.start_time || '').localeCompare(String(b.event.start_time || '')) || String(a.label || '').localeCompare(String(b.label || ''), 'zh'));
    const first = children[0].event;
    const sessions = children.flatMap(member => {
      const child = member.event;
      const source = child.sessions?.length ? child.sessions : [{ id: child.id + '-session-1', date: child.date, performances: [], songs: [], character_ids: child.character_ids || [] }];
      return source.map(session => ({
        ...session, source_event_id: child.id,
        label: unitLabel(source.length === 1 ? (member.label || child.title) : [member.label, session.label].filter(Boolean).join('、')),
        date: session.date || child.date,
        venue: session.venue || child.venue || '',
        venue_id: session.venue_id || child.venue_id || '',
        doors_time: session.doors_time || child.doors_time || '',
        start_time: session.start_time || child.start_time || '',
        end_time: session.end_time || child.end_time || '',
        broadcast_time: session.broadcast_time || child.broadcast_time || '',
        cast: Array.isArray(session.cast) ? session.cast : source.length === 1 ? child.cast || [] : [],
        image: session.image || child.image,
        image_preview: session.image_preview || child.image_preview || child.image,
        image_original: session.image_original || child.image_original,
        summary: session.summary || child.summary_zh || child.summary || '',
        media: session.media || (source.length === 1 ? child.media || [] : []),
        sources: session.sources || child.sources || [],
        schedule_status: session.schedule_status || child.schedule_status || '',
        status_note: session.status_note || child.status_note || '',
        status_source_url: session.status_source_url || child.status_source_url || '',
      }));
    });
    const cancelled = sessions.filter(session => session.schedule_status === 'cancelled').length;
    if (group.session_days?.length) {
      for (const session of sessions) {
        const day = group.session_days.indexOf(session.date);
        if (day < 0) continue;
        const sameDay = sessions.filter(item => item.date === session.date)
          .sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
        session.label = 'DAY' + (day + 1) + (sameDay.length > 1 ? '　第' + (sameDay.indexOf(session) + 1) + '回' : '');
      }
    }
    const parent = {
      ...first, id: group.id, title: first.display_title || group.title, title_zh: first.display_title || group.title,
      title_ja: group.title_ja || '', title_aliases: children.flatMap(member => [member.event.title, member.event.title_ja]).filter(Boolean),
      summary: group.summary || '', summary_zh: group.summary || '', summary_ja: '',
      date: group.date_start || first.date,
      end_date: group.kind === 'competition' ? (group.confirmed_end_date || '') : group.date_end || children.at(-1).event.end_date || children.at(-1).event.date,
      sort_date: children.at(-1).event.date,
      doors_time: '', start_time: '', end_time: '', broadcast_time: '',
      venue: children.every(member => member.event.venue === first.venue) ? first.venue : '',
      venue_id: children.every(member => member.event.venue_id === first.venue_id) ? first.venue_id : '',
      status_note: group.status_note || '', status_source_url: group.status_source_url || '',
      image: sessions[0].image || first.image,
      image_preview: sessions[0].image_preview || sessions[0].image || first.image_preview || first.image,
      image_original: sessions[0].image_original || sessions[0].image || first.image_original,
      unit_kind: group.kind === 'competition' ? '赛程' : ['series_arc', 'online_series'].includes(group.kind) ? '分集' : '场次',
      sessions,
      cast: unique(children.flatMap(member => member.event.cast || []), cast => cast.voice_actor_id || cast.character_id || cast.name || JSON.stringify(cast)),
      character_ids: [...new Set(children.flatMap(member => member.event.character_ids || []))],
      sources: unique(members.flatMap(member => member.event.sources || []), source => source.url || JSON.stringify(source)),
      schedule_status: cancelled === sessions.length ? 'cancelled' : cancelled ? 'partially_cancelled' : '',
      child_event_ids: children.map(member => member.event.id),
    };
    parents.push(parent);
    byId.set(parent.id, parent);
    for (const member of members) {
      hidden.add(member.event.id);
      const session = sessions.find(session => session.source_event_id === member.event.id);
      parentForChild.set(member.event.id, { parent, session_id: session?.id || sessions[0]?.id });
    }
  }
  return { events: [...events.filter(event => !hidden.has(event.id)), ...parents], byId, rawById, parentForChild };
}

module.exports = { projectEvents };

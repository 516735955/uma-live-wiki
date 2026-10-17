'use strict';

// Event dates use the site's Asia/Shanghai calendar, independent of host timezone.
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
function today(now = new Date()) { return formatter.format(now); }
function eventDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : ''; }
module.exports = { today, eventDate };

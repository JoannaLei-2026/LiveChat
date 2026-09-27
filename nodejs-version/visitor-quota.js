const crypto = require('node:crypto');

const COOKIE = 'livechat_visitor';
const dayInTaipei = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(now);

function createQuota({ store, secret, limit = 500, now = () => new Date() }) {
  if (!secret || secret.length < 32) throw new Error('VISITOR_COOKIE_SECRET must contain at least 32 characters');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('DAILY_VISITOR_LIMIT must be a positive integer');
  const sign = value => crypto.createHmac('sha256', secret).update(value).digest('base64url');
  function decode(header = '') {
    const token = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token || token.length > 200) return null;
    const [id, day, signature, extra] = token.split('.');
    if (extra !== undefined || !/^[a-f0-9]{32}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !signature) return null;
    const expected = Buffer.from(sign(`${id}.${day}`));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    return { id, day };
  }
  return {
    permitted(header) { return decode(header)?.day === dayInTaipei(now()); },
    async admit(header) {
      const date = now();
      const day = dayInTaipei(date);
      const previous = decode(header);
      const id = previous?.id || crypto.randomBytes(16).toString('hex');
      if (previous?.day !== day && !await store.admit(day, id, limit)) return null;
      const value = `${id}.${day}`;
      return `${COOKIE}=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
    }
  };
}

// A single transaction arbitrates the last place across instances and revisions.
function firestoreStore(db, collection = 'livechat_daily_visitors') {
  return {
    admit(day, id, limit) {
      const daily = db.collection(collection).doc(day);
      const visitor = daily.collection('visitors').doc(id);
      return db.runTransaction(async transaction => {
        const [visitorSnapshot, dailySnapshot] = await transaction.getAll(visitor, daily);
        if (visitorSnapshot.exists) return true;
        const count = dailySnapshot.exists ? dailySnapshot.get('count') : 0;
        if (!Number.isInteger(count) || count < 0) throw new Error('Invalid daily visitor counter');
        if (count >= limit) return false;
        transaction.set(daily, { count: count + 1 });
        transaction.create(visitor, { admitted: true });
        return true;
      });
    }
  };
}

module.exports = { createQuota, firestoreStore, dayInTaipei };

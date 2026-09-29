'use strict';
/* Records every privileged action. `q` may be the pool module or a transaction client. */
async function audit(q, req, action, targetType, targetId, details) {
  await q.query(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user ? req.user.id : null, action, targetType || null, targetId == null ? null : String(targetId), JSON.stringify(details || {}), req.ip || null]);
}
module.exports = { audit };

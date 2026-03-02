import fs from 'fs'
import path from 'path'
import config from '../../config.js'

/** Cache LID user-part → nomor HP **/
const lidCache = new Map()

/**
 * Isi lidCache dari data participant groupMetadata.
 * @param {string} lidJid   - JID format @lid
 * @param {string} phoneJid - JID format @s.whatsapp.net
 */
export function cacheLidMapping(lidJid, phoneJid) {
    if (!lidJid?.endsWith('@lid') || !phoneJid?.endsWith('@s.whatsapp.net')) return
    const lidUser = lidJid.split('@')[0].split(':')[0]
    const phoneUser = phoneJid.split('@')[0]
    if (lidUser && phoneUser) lidCache.set(lidUser, phoneUser)
}

/**
 * Resolve LID user-part ke nomor HP via cache atau file session.
 * @param {string} lidUser
 * @returns {string|null}
 */
function lidToPhone(lidUser) {
    if (lidCache.has(lidUser)) return lidCache.get(lidUser)

    const file = path.join(path.resolve(`./${config.sessionName}`), `lid-mapping-${lidUser}_reverse.json`)

    try {
        if (fs.existsSync(file)) {
            const phone = JSON.parse(fs.readFileSync(file, 'utf8'))
            if (phone) {
                lidCache.set(lidUser, phone)
                return phone
            }
        }
    } catch {}

    return null
}

/**
 * Normalize JID: konvert @lid → @s.whatsapp.net jika mapping tersedia.
 * JID selain @lid dikembalikan apa adanya.
 * @param {string} jid
 * @returns {string}
 */
export function normalizeJid(jid) {
    if (!jid || !jid.endsWith('@lid')) return jid
    /** Strip device number: "99987654321012:2@lid" → "99987654321012" **/
    const lidUser = jid.split('@')[0].split(':')[0]
    const phone = lidToPhone(lidUser)
    return phone ? `${phone}@s.whatsapp.net` : jid
}

import { normalizeJid } from './jid.js'

/**
 * Ambil target participant JID dari pesan.
 * Prioritas: @mention → quoted reply → nomor di args
 *
 * @param {object} msg     - WAMessage
 * @param {string} text    - teks setelah command (untuk nomor HP)
 * @returns {string|null}  - JID dalam format @s.whatsapp.net, atau null
 */
export function getTargetJid(msg, text) {
    /** Ambil contextInfo dari semua message types yang mendukung reply/mention.
     *  Tidak boleh hanya baca extendedTextMessage.contextInfo — admin bisa reply
     *  pesan media (imageMessage, videoMessage, dll) untuk menentukan target. **/
    const rawMsg = msg.message || {}

    /** Unwrap wrapper types satu level (sama seperti handler.js) **/
    const WRAPPER_TYPES = [
        'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
        'ephemeralMessage', 'documentWithCaptionMessage', 'editedMessage',
    ]
    let innerMsg = rawMsg
    for (const wt of WRAPPER_TYPES) {
        if (rawMsg[wt]?.message) { innerMsg = rawMsg[wt].message; break }
    }

    /** Cari tipe konten pertama yang bukan metadata **/
    const META_KEYS = ['messageContextInfo', 'senderKeyDistributionMessage', 'deviceSentMessage']
    const contentType = Object.keys(innerMsg).find(k => !META_KEYS.includes(k))
    const ctx = contentType ? innerMsg[contentType]?.contextInfo : null

    // 1. @mention
    const mentions = ctx?.mentionedJid
    if (mentions?.length > 0) return normalizeJid(mentions[0])

    // 2. Quoted reply — hanya valid jika stanzaId ada (itu yang membedakan
    //    reply sungguhan vs contextInfo dari forwarded/device message biasa)
    if (ctx?.stanzaId && ctx?.participant) return normalizeJid(ctx.participant)

    // 3. Nomor dari args (strip non-digit, tambah @s.whatsapp.net)
    if (text) {
        const phone = text.replace(/[^0-9]/g, '')
        if (phone.length >= 7) return `${phone}@s.whatsapp.net`
    }

    return null
}

/**
 * Terjemahkan status code dari groupParticipantsUpdate ke pesan human-readable.
 * @param {string} status
 * @param {string} action - 'add' | 'remove' | 'promote' | 'demote'
 * @returns {string}
 */
export function translateStatus(status, action) {
    const s = String(status)
    if (s === '200') return null // sukses, tidak perlu pesan error

    const map = {
        '403': {
            add:     'Pengguna tidak bisa ditambahkan (pengaturan privasi atau bukan kontak).',
            remove:  'Tidak bisa mengeluarkan pengguna ini.',
            promote: 'Tidak bisa mempromosikan pengguna ini.',
            demote:  'Tidak bisa menurunkan pengguna ini.',
        },
        '408': {
            add: 'Nomor tidak terdaftar di WhatsApp.',
        },
        '409': {
            add: 'Pengguna sudah ada di dalam grup.',
        },
        '500': {
            add:     'Terjadi kesalahan internal saat menambahkan.',
            remove:  'Terjadi kesalahan internal saat mengeluarkan.',
            promote: 'Terjadi kesalahan internal saat mempromosikan.',
            demote:  'Terjadi kesalahan internal saat menurunkan.',
        },
    }

    return map[s]?.[action] ?? map[s]?.add ?? `Gagal (kode: ${s}).`
}

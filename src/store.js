import { updateMessageWithReaction, updateMessageWithReceipt } from 'baileys'
import logger from './utils/logger.js'
import { normalizeJid } from './utils/jid.js'

class WAStore {
    constructor() {
        /** jid → { msgId → WAMessage } **/
        this.messages = {}

        /** jid → WAChat **/
        this.chats = {}

        /** jid → WAContact **/
        this.contacts = {}

        /** jid → GroupMetadata **/
        this.groupMetadata = {}
    }

    /** Bind semua event Baileys ke store **/
    bind(ev) {
        /** ── HISTORY SYNC ── **/
        ev.on('messaging-history.set', ({ messages: msgs, chats, contacts, isLatest }) => {
            for (const msg of msgs) {
                const jid = msg.key?.remoteJid
                if (!jid) continue
                if (!this.messages[jid]) this.messages[jid] = {}
                this.messages[jid][msg.key.id] = msg
            }
            for (const chat of chats) {
                this.chats[chat.id] = { ...this.chats[chat.id], ...chat }
            }
            for (const contact of contacts) {
                this.contacts[contact.id] = { ...this.contacts[contact.id], ...contact }
            }
            logger.info(`[Store] History sync: ${msgs.length} messages, ${chats.length} chats, ${contacts.length} contacts`)
        })

        /** ── MESSAGES ── **/
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                const jid = msg.key?.remoteJid
                if (!jid) continue
                if (!this.messages[jid]) this.messages[jid] = {}
                this.messages[jid][msg.key.id] = msg
            }
        })

        ev.on('messages.update', (updates) => {
            for (const update of updates) {
                const jid = update.key?.remoteJid
                if (!jid) continue
                if (!this.messages[jid]) this.messages[jid] = {}
                const existing = this.messages[jid][update.key.id]
                if (existing) {
                    Object.assign(existing, update.update)
                }
            }
        })

        ev.on('messages.delete', (item) => {
            if ('all' in item) {
                this.messages[item.jid] = {}
            } else {
                for (const key of item.keys) {
                    if (this.messages[key.remoteJid]) {
                        delete this.messages[key.remoteJid][key.id]
                    }
                }
            }
        })

        ev.on('messages.reaction', (reactions) => {
            for (const { key, reaction } of reactions) {
                const msg = this.messages[key.remoteJid]?.[key.id]
                if (msg) updateMessageWithReaction(msg, reaction)
            }
        })

        ev.on('message-receipt.update', (receipts) => {
            for (const { key, receipt } of receipts) {
                const msg = this.messages[key.remoteJid]?.[key.id]
                if (msg) updateMessageWithReceipt(msg, receipt)
            }
        })

        /** ── CHATS ── **/
        ev.on('chats.upsert', (chats) => {
            for (const chat of chats) {
                this.chats[chat.id] = { ...this.chats[chat.id], ...chat }
            }
        })

        ev.on('chats.update', (updates) => {
            for (const update of updates) {
                this.chats[update.id] = { ...this.chats[update.id], ...update }
            }
        })

        ev.on('chats.delete', (jids) => {
            for (const jid of jids) {
                delete this.chats[jid]
                delete this.messages[jid]
            }
        })

        /** ── CONTACTS ── **/
        ev.on('contacts.upsert', (contacts) => {
            for (const contact of contacts) {
                this.contacts[contact.id] = { ...this.contacts[contact.id], ...contact }
            }
        })

        ev.on('contacts.update', (updates) => {
            for (const update of updates) {
                this.contacts[update.id] = { ...this.contacts[update.id], ...update }
            }
        })

        /** ── GROUPS ── **/
        ev.on('groups.upsert', (groups) => {
            for (const group of groups) {
                this.groupMetadata[group.id] = group
            }
        })

        ev.on('groups.update', (updates) => {
            for (const update of updates) {
                if (this.groupMetadata[update.id]) {
                    Object.assign(this.groupMetadata[update.id], update)
                } else {
                    this.groupMetadata[update.id] = update
                }
            }
        })

        ev.on('group-participants.update', ({ id, participants, action }) => {
            const group = this.groupMetadata[id]
            if (group) {
                /** Guard: pastikan array ada **/
                if (!Array.isArray(group.participants)) group.participants = []

                switch (action) {
                    case 'add':
                        /** Normalize JID saat participant baru masuk — di LID-mode grup,
                         *  jid bisa berupa @lid. Simpan dalam bentuk @s.whatsapp.net
                         *  agar konsisten dengan semua perbandingan di handler. **/
                        group.participants.push(...participants.map(jid => ({ id: normalizeJid(jid) ?? jid, admin: null })))
                        break
                    case 'remove':
                    case 'leave': {
                        /** Normalize both sides: @lid → @s.whatsapp.net sebelum dicocokkan **/
                        const normalizedTargets = new Set(participants.map(normalizeJid))
                        group.participants = group.participants.filter(p => !normalizedTargets.has(normalizeJid(p.id)))
                        break
                    }
                    case 'promote':
                        group.participants = group.participants.map(p =>
                            participants.some(jid => normalizeJid(jid) === normalizeJid(p.id))
                                ? { ...p, admin: 'admin' } : p
                        )
                        break
                    case 'demote':
                        group.participants = group.participants.map(p =>
                            participants.some(jid => normalizeJid(jid) === normalizeJid(p.id))
                                ? { ...p, admin: null } : p
                        )
                        break
                }
            }

            logger.info(`Store group ${id}: ${action} → [${participants.join(', ')}]`)
        })

        logger.ready('Store bound to socket events')
    }

    /** Digunakan di getMessage() socket config **/
    getMessage(key) {
        return this.messages[key.remoteJid]?.[key.id]
    }

    /** Helper: ambil nama kontak, fallback ke nomor **/
    getContactName(jid) {
        const c = this.contacts[jid]
        return c?.name || c?.notify || jid.split('@')[0]
    }

    /** Helper: cek apakah jid ada di chats **/
    hasChat(jid) {
        return !!this.chats[jid]
    }
}

const store = new WAStore()
export default store
